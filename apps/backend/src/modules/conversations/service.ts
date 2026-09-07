import { randomUUID } from 'node:crypto';

import { and, asc, count, desc, eq, exists, isNull, sql } from 'drizzle-orm';

import {
  conversation as conversationTable,
  conversationMessage as conversationMessageTable,
  type ConversationMessageMetadata,
} from '@gloaming/db';
import {
  CONVERSATION_CONTENT_MAX,
  CONVERSATION_DETAIL_MESSAGE_CAP,
  CONVERSATION_PREVIEW_MAX,
  type ConversationDetail,
  type ConversationListData,
  type ConversationListQuery,
  type ConversationMessageDto,
  type ConversationMessageStatus,
  type ConversationSubjectType,
  type ConversationSummary,
  type ConversationSurface,
  type CreateConversationBody,
} from '@gloaming/shared';
import { buildPaginationMeta } from '@gloaming/shared/pagination';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError, NotFoundError } from '@/lib/errors';

type ConversationRow = typeof conversationTable.$inferSelect;
type MessageRow = typeof conversationMessageTable.$inferSelect;

function toSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    surface: row.surface as ConversationSurface,
    subjectType: row.subjectType as ConversationSubjectType,
    subjectId: row.subjectId,
    preview: row.preview,
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toMessage(row: MessageRow): ConversationMessageDto {
  return {
    id: row.id,
    role: row.role as ConversationMessageDto['role'],
    content: row.content,
    status: row.status as ConversationMessageDto['status'],
    metadata: row.metadata ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

function truncatePreview(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= CONVERSATION_PREVIEW_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, CONVERSATION_PREVIEW_MAX - 1)}…`;
}

function clampContent(text: string): string {
  if (text.length <= CONVERSATION_CONTENT_MAX) {
    return text;
  }
  return text.slice(0, CONVERSATION_CONTENT_MAX);
}

async function endOpenInScope(
  tx: typeof db,
  input: {
    userId: string;
    surface: string;
    subjectType: string;
    subjectId: string;
    exceptId?: string;
  },
): Promise<void> {
  const conditions = [
    eq(conversationTable.userId, input.userId),
    eq(conversationTable.surface, input.surface),
    eq(conversationTable.subjectType, input.subjectType),
    eq(conversationTable.subjectId, input.subjectId),
    isNull(conversationTable.endedAt),
  ];
  if (input.exceptId) {
    conditions.push(sql`${conversationTable.id} <> ${input.exceptId}`);
  }
  await tx
    .update(conversationTable)
    .set({ endedAt: new Date() })
    .where(and(...conditions));
}

export async function createConversation(userId: string, body: CreateConversationBody): Promise<ConversationSummary> {
  const id = randomUUID();
  const now = new Date();

  const row = await db.transaction(async (tx) => {
    await endOpenInScope(tx as unknown as typeof db, {
      userId,
      surface: body.surface,
      subjectType: body.subjectType,
      subjectId: body.subjectId,
    });

    const [inserted] = await tx
      .insert(conversationTable)
      .values({
        id,
        userId,
        surface: body.surface,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        preview: '',
        endedAt: null,
        lastMessageAt: now,
      })
      .returning();

    return inserted!;
  });

  return toSummary(row);
}

export async function listConversations(userId: string, query: ConversationListQuery): Promise<ConversationListData> {
  const hasMessage = exists(
    db
      .select({ one: sql`1` })
      .from(conversationMessageTable)
      .where(eq(conversationMessageTable.conversationId, conversationTable.id)),
  );

  const filters = [eq(conversationTable.userId, userId), hasMessage];
  if (query.surface) {
    filters.push(eq(conversationTable.surface, query.surface));
  }
  if (query.subjectType && query.subjectId) {
    filters.push(eq(conversationTable.subjectType, query.subjectType));
    filters.push(eq(conversationTable.subjectId, query.subjectId));
  }

  const whereClause = and(...filters)!;
  const orderPrimary =
    query.sortOrder === 'asc' ? asc(conversationTable.lastMessageAt) : desc(conversationTable.lastMessageAt);

  const [{ total }] = await db.select({ total: count() }).from(conversationTable).where(whereClause);
  const offset = (query.page - 1) * query.pageSize;
  const rows = await db
    .select()
    .from(conversationTable)
    .where(whereClause)
    .orderBy(orderPrimary, desc(conversationTable.id))
    .limit(query.pageSize)
    .offset(offset);

  return {
    items: rows.map(toSummary),
    pagination: buildPaginationMeta({
      page: query.page,
      pageSize: query.pageSize,
      total,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
  };
}

export async function getConversation(userId: string, conversationId: string): Promise<ConversationDetail> {
  const rows = await db
    .select()
    .from(conversationTable)
    .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError('Conversation');
  }

  const messageRows = await db
    .select()
    .from(conversationMessageTable)
    .where(eq(conversationMessageTable.conversationId, conversationId))
    .orderBy(desc(conversationMessageTable.createdAt), desc(conversationMessageTable.id))
    .limit(CONVERSATION_DETAIL_MESSAGE_CAP);

  const chronological = [...messageRows].reverse();

  return {
    ...toSummary(row),
    messages: chronological.map(toMessage),
  };
}

/**
 * Ensure an existing conversation belongs to the user and matches assist-read + reading work.
 * Call before streaming so a bad id fails fast (404 / 400) instead of after the reply.
 */
export async function assertAssistConversation(input: {
  userId: string;
  conversationId: string;
  workId: string;
}): Promise<void> {
  const rows = await db
    .select()
    .from(conversationTable)
    .where(and(eq(conversationTable.id, input.conversationId), eq(conversationTable.userId, input.userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError('Conversation');
  }
  if (row.surface !== 'assist-read' || row.subjectType !== 'reading_work') {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, 'conversation does not match surface');
  }
  if (row.subjectId !== input.workId) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, 'conversation does not match work');
  }
}

export type AppendTurnInput = {
  userId: string;
  conversationId?: string;
  surface: ConversationSurface;
  subjectType: ConversationSubjectType;
  subjectId: string;
  userContent: string;
  assistantContent: string;
  assistantStatus: ConversationMessageStatus;
  userMetadata?: ConversationMessageMetadata;
  assistantMetadata?: ConversationMessageMetadata;
};

/**
 * Create or resume a conversation and append one user + assistant turn.
 * Used by assist.ask after the model reply (best-effort from the caller's side).
 */
export async function appendAssistTurn(input: AppendTurnInput): Promise<{ conversationId: string }> {
  const userContent = clampContent(input.userContent);
  const assistantContent = clampContent(input.assistantContent);
  const now = new Date();

  return db.transaction(async (tx) => {
    let conversationId = input.conversationId;

    if (conversationId) {
      const existing = await tx
        .select()
        .from(conversationTable)
        .where(and(eq(conversationTable.id, conversationId), eq(conversationTable.userId, input.userId)))
        .limit(1);
      const row = existing[0];
      if (!row) {
        throw new NotFoundError('Conversation');
      }
      if (row.surface !== input.surface || row.subjectType !== input.subjectType) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, 'conversation does not match surface');
      }
      if (row.subjectId !== input.subjectId) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, 'conversation does not match work');
      }

      await endOpenInScope(tx as unknown as typeof db, {
        userId: input.userId,
        surface: input.surface,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        exceptId: conversationId,
      });

      await tx
        .update(conversationTable)
        .set({ endedAt: null, lastMessageAt: now })
        .where(eq(conversationTable.id, conversationId));
    } else {
      conversationId = randomUUID();
      await endOpenInScope(tx as unknown as typeof db, {
        userId: input.userId,
        surface: input.surface,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      });
      await tx.insert(conversationTable).values({
        id: conversationId,
        userId: input.userId,
        surface: input.surface,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        preview: truncatePreview(userContent),
        endedAt: null,
        lastMessageAt: now,
      });
    }

    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const userCreatedAt = now;
    const assistantCreatedAt = new Date(now.getTime() + 1);

    await tx.insert(conversationMessageTable).values([
      {
        id: userMessageId,
        conversationId,
        role: 'user',
        content: userContent,
        status: 'complete',
        metadata: input.userMetadata ?? {},
        createdAt: userCreatedAt,
      },
      {
        id: assistantMessageId,
        conversationId,
        role: 'assistant',
        content: assistantContent,
        status: input.assistantStatus,
        metadata: input.assistantMetadata ?? {},
        createdAt: assistantCreatedAt,
      },
    ]);

    const current = await tx
      .select({ preview: conversationTable.preview })
      .from(conversationTable)
      .where(eq(conversationTable.id, conversationId))
      .limit(1);

    const previewUpdate = current[0]?.preview?.trim() ? undefined : { preview: truncatePreview(userContent) };

    await tx
      .update(conversationTable)
      .set({
        lastMessageAt: now,
        endedAt: null,
        ...previewUpdate,
      })
      .where(eq(conversationTable.id, conversationId));

    return { conversationId };
  });
}
