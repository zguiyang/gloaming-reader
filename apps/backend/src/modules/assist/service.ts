import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';
import { type AssistAskBody } from '@gloaming/shared/assist';

import { db } from '@/db';
import { NotFoundError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import { htmlToPlainText } from '@/lib/part-text';
import { composePromptMessages, PROMPT_ROLE, PROMPT_SCENE, type PromptMessage, renderPrompt } from '@/lib/prompts';
import { type AiStreamDeltaEvent, type AiStreamDoneEvent, invokeAi, streamAi } from '@/modules/ai';
import { truncatePreview } from '@/modules/ai/log';
import { resolveAssistToolsForAction } from '@/modules/assist/tools';
import * as conversationsService from '@/modules/conversations/service';

const assistLogger = rootLogger.child({ module: 'Assist' });

const followUpSuggestionsSchema = z.object({
  suggestions: z.array(z.string().min(1).max(48)).length(3),
});

const MEMORY_NOTES_MAX = 5;
const MEMORY_NOTES_CHARS_MAX = 800;

const ACTION_USER_LABEL: Record<AssistAskBody['actionId'], string> = {
  meaning: '这句话什么意思',
  simpler: '换简单说法',
  referent: '指代是谁',
  explain: '解释一下',
  qa: '提问',
  lookup: '查词',
  gist: '总结大意',
};

function neighborWindow(body: string, selection: string, radius = 120): string {
  const index = body.indexOf(selection);
  if (index < 0) {
    return '';
  }
  const start = Math.max(0, index - radius);
  const end = Math.min(body.length, index + selection.length + radius);
  return body.slice(start, end);
}

function userDisplayContent(body: AssistAskBody): string {
  if (body.actionId === 'qa') {
    return body.question?.trim() || ACTION_USER_LABEL.qa;
  }
  return ACTION_USER_LABEL[body.actionId];
}

function formatMemoryNotes(notes: string[]): string {
  const capped = notes
    .map((note) => note.trim())
    .filter(Boolean)
    .slice(0, MEMORY_NOTES_MAX);
  if (capped.length === 0) {
    return '';
  }
  let joined = capped.map((note) => `- ${note}`).join('\n');
  if (joined.length > MEMORY_NOTES_CHARS_MAX) {
    joined = `${joined.slice(0, MEMORY_NOTES_CHARS_MAX - 1)}…`;
  }
  return `Known about this learner (from prior study — keep brief, do not dump full history):\n${joined}`;
}

export type LearnerMemoryInput = {
  userId: string;
  workId: string;
  partId: string;
  actionId: AssistAskBody['actionId'];
  selection?: string;
  question?: string;
  conversationId?: string;
};

export type LearnerMemoryResult = {
  notes: string[];
};

export async function loadLearnerMemory(_input: LearnerMemoryInput): Promise<LearnerMemoryResult> {
  return { notes: [] };
}

export type StreamAssistAskOptions = {
  signal?: AbortSignal;
};

export type AssistStreamDoneEvent = AiStreamDoneEvent & {
  suggestions?: string[];
  conversationId?: string;
};

export type AssistStreamEvent = AiStreamDeltaEvent | AssistStreamDoneEvent;

async function buildFollowUpMessages(input: {
  workTitle: string;
  actionId: AssistAskBody['actionId'];
  selection?: string;
  question?: string;
  replyText: string;
}): Promise<PromptMessage[]> {
  const vars = {
    targetLanguage: 'English',
    replyLanguage: 'Chinese',
    workTitle: input.workTitle,
  };
  const [role, base, task] = await Promise.all([
    renderPrompt(`roles/${PROMPT_ROLE.languageTeacher}`, vars),
    renderPrompt(`scenes/${PROMPT_SCENE.assistRead}/base`, vars),
    renderPrompt(`scenes/${PROMPT_SCENE.assistRead}/follow-ups`, vars),
  ]);

  const userLines = [
    `Action: ${input.actionId}`,
    input.selection ? `Selection: ${truncatePreview(input.selection)}` : null,
    input.question ? `Question: ${truncatePreview(input.question)}` : null,
    `Assistant reply: ${truncatePreview(input.replyText)}`,
  ].filter((line): line is string => Boolean(line));

  return [
    { role: 'system', content: [role, base, task].filter(Boolean).join('\n\n') },
    { role: 'user', content: userLines.join('\n') },
  ];
}

async function loadPublishedPart(workId: string, partId: string) {
  const rows = await db
    .select({
      workId: readingWorkTable.id,
      workTitle: readingWorkTable.title,
      partId: readingPartTable.id,
      partTitle: readingPartTable.title,
      body: readingPartTable.body,
    })
    .from(readingPartTable)
    .innerJoin(readingWorkTable, eq(readingPartTable.workId, readingWorkTable.id))
    .where(
      and(
        eq(readingPartTable.id, partId),
        eq(readingPartTable.workId, workId),
        eq(readingWorkTable.status, 'published'),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError('Part');
  }
  return row;
}

export async function* streamAssistAsk(
  userId: string,
  body: AssistAskBody,
  options?: StreamAssistAskOptions,
): AsyncGenerator<AssistStreamEvent> {
  const part = await loadPublishedPart(body.workId, body.partId);

  if (body.conversationId) {
    await conversationsService.assertAssistConversation({
      userId,
      conversationId: body.conversationId,
      workId: part.workId,
    });
  }

  const selection = body.selection?.trim() || undefined;
  const question = body.question?.trim() || undefined;
  const partText = htmlToPlainText(part.body);
  const neighbor = selection ? neighborWindow(partText, selection) : '';
  const tools = resolveAssistToolsForAction(body.actionId, {
    title: part.partTitle,
    body: partText,
  });

  const memory = await loadLearnerMemory({
    userId,
    workId: part.workId,
    partId: part.partId,
    actionId: body.actionId,
    selection,
    question,
    conversationId: body.conversationId,
  });
  const memoryBlock = formatMemoryNotes(memory.notes);

  const messages = await composePromptMessages({
    roleId: PROMPT_ROLE.languageTeacher,
    sceneId: PROMPT_SCENE.assistRead,
    actionId: body.actionId,
    vars: {
      targetLanguage: 'English',
      replyLanguage: 'Chinese',
      workTitle: part.workTitle,
      selection,
      selectionNote: selection
        ? undefined
        : 'No text selection — answer for the reading part as a whole (use tools if you need the body).',
      neighbor: neighbor || undefined,
      question,
    },
  });

  if (memoryBlock && messages[0]?.role === 'system') {
    messages[0] = {
      role: 'system',
      content: `${messages[0].content}\n\n${memoryBlock}`,
    };
  }

  let doneEvent: AiStreamDoneEvent | undefined;

  for await (const event of streamAi({
    purpose: 'assist',
    source: 'assist.ask',
    userId,
    ref: { type: 'reading_work', id: part.workId },
    tools,
    signal: options?.signal,
    requestSummaryExtra: { actionId: body.actionId },
    messages,
  })) {
    if (event.type === 'delta') {
      yield event;
      continue;
    }
    doneEvent = event;
  }

  if (!doneEvent) {
    return;
  }

  if (options?.signal?.aborted) {
    return;
  }

  let suggestions: string[] | undefined;
  try {
    const followUpMessages = await buildFollowUpMessages({
      workTitle: part.workTitle,
      actionId: body.actionId,
      selection,
      question,
      replyText: doneEvent.content,
    });
    const followUp = await invokeAi({
      purpose: 'assist',
      source: 'assist.ask.followups',
      userId,
      ref: { type: 'reading_work', id: part.workId },
      messages: followUpMessages,
      outputSchema: followUpSuggestionsSchema,
      timeoutMs: 20_000,
      requestSummaryExtra: { actionId: body.actionId, phase: 'followups' },
    });
    suggestions = followUp.content.suggestions;
  } catch {
    // Follow-ups are optional.
  }

  if (options?.signal?.aborted) {
    return;
  }

  let conversationId: string | undefined;
  try {
    const persisted = await conversationsService.appendAssistTurn({
      userId,
      conversationId: body.conversationId,
      surface: 'assist-read',
      subjectType: 'reading_work',
      subjectId: part.workId,
      userContent: userDisplayContent(body),
      assistantContent: doneEvent.content,
      assistantStatus: 'complete',
      userMetadata: {
        actionId: body.actionId,
        ...(selection ? { selection } : {}),
        ...(question ? { question } : {}),
      },
      assistantMetadata: {
        ...(suggestions?.length ? { suggestions } : {}),
      },
    });
    conversationId = persisted.conversationId;
  } catch (error) {
    assistLogger.error({ err: error }, 'Failed to persist assist conversation turn');
  }

  yield {
    ...doneEvent,
    ...(suggestions ? { suggestions } : {}),
    ...(conversationId ? { conversationId } : {}),
  };
}
