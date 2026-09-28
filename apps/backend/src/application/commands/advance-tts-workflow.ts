import { eq } from 'drizzle-orm';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';
import { buildPartAudioText } from '@gloaming/shared/content-assets';
import { type TtsVoiceRole } from '@gloaming/shared/tts';

import { needsRegen } from '@/domains/assets';
import { hashPartAudioContent, htmlToPlainText } from '@/domains/works/content';
import { completeWorkflowStep, TTS_STEP_ENABLED } from '@/domains/works/lifecycle';
import { db } from '@/infra/db';

const ALL_ROLES: TtsVoiceRole[] = ['us', 'uk'];

export async function tryAdvanceTtsWorkflow(workId: string): Promise<void> {
  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  const ttsWorkflowActive =
    work?.originMeta.workflowEnqueueStep === 'tts' || work?.originMeta.workflowClaimStep === 'tts';
  if (!work || work.processingStatus !== 'ready' || !ttsWorkflowActive) {
    return;
  }
  // Auto-TTS pipeline off: never block publish on chapter audio.
  if (!TTS_STEP_ENABLED) {
    await completeWorkflowStep(workId, 'ready', undefined, 'ready');
    return;
  }

  const parts = await db
    .select({
      id: readingPartTable.id,
      title: readingPartTable.title,
      body: readingPartTable.body,
    })
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId));

  if (parts.length === 0) {
    await completeWorkflowStep(workId, 'ready', undefined, 'ready');
    return;
  }

  for (const part of parts) {
    const text = buildPartAudioText(htmlToPlainText(part.body));
    if (!text.trim()) {
      continue;
    }
    const contentHash = hashPartAudioContent(part.body);
    for (const role of ALL_ROLES) {
      if (await needsRegen(part.id, role, contentHash)) {
        return;
      }
    }
  }

  await completeWorkflowStep(workId, 'ready', undefined, 'ready');
}
