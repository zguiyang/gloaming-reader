import { randomUUID } from 'node:crypto';

import { and, asc, count, desc, eq, gte, lte, type SQL, sql } from 'drizzle-orm';

import {
  aiInvocationLog as aiInvocationLogTable,
  type AiInvocationRequestSummary,
  type AiInvocationResponseSummary,
} from '@gloaming/db';
import {
  type AiInvocationListData,
  type AiInvocationListQuery,
  type AiInvocationLog,
  type AiInvocationStats,
  type AiInvocationStatsQuery,
  type AiInvocationStatus,
  resolveAiInvocationWindow,
} from '@gloaming/shared/ai-invocations';
import { buildPaginationMeta } from '@gloaming/shared/pagination';

import { db } from '@/db';

const PREVIEW_MAX = 200;
const ERROR_MESSAGE_MAX = 500;

export type InvocationLogInput = {
  status: 'success' | 'failure';
  errorCode?: string;
  errorMessage?: string;
  purpose?: string | null;
  source: string;
  userId?: string | null;
  refType?: string | null;
  refId?: string | null;
  modelRowId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  baseUrl?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  requestSummary?: AiInvocationRequestSummary | null;
  responseSummary?: AiInvocationResponseSummary | null;
};

export function truncatePreview(text: string, max = PREVIEW_MAX): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

export function truncateErrorMessage(message: string): string {
  return truncatePreview(message, ERROR_MESSAGE_MAX);
}

/** Persist one business-level AI invocation (summary A — no full prompts). */
export async function recordInvocation(input: InvocationLogInput): Promise<void> {
  await db.insert(aiInvocationLogTable).values({
    id: randomUUID(),
    status: input.status,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ? truncateErrorMessage(input.errorMessage) : null,
    purpose: input.purpose ?? null,
    source: input.source,
    userId: input.userId ?? null,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    modelRowId: input.modelRowId ?? null,
    providerId: input.providerId ?? null,
    modelId: input.modelId ?? null,
    baseUrl: input.baseUrl ?? null,
    latencyMs: input.latencyMs ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    totalTokens: input.totalTokens ?? null,
    costAmount: null,
    costCurrency: null,
    requestSummary: input.requestSummary ?? null,
    responseSummary: input.responseSummary ?? null,
  });
}

type InvocationLogRow = typeof aiInvocationLogTable.$inferSelect;

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStatus(value: string): AiInvocationStatus {
  return value === 'failure' ? 'failure' : 'success';
}

function toLog(row: InvocationLogRow): AiInvocationLog {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    status: toStatus(row.status),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    purpose: row.purpose,
    source: row.source,
    userId: row.userId,
    refType: row.refType,
    refId: row.refId,
    modelRowId: row.modelRowId,
    providerId: row.providerId,
    modelId: row.modelId,
    baseUrl: row.baseUrl,
    latencyMs: row.latencyMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    costAmount: toNullableNumber(row.costAmount),
    costCurrency: row.costCurrency,
    requestSummary: row.requestSummary ?? null,
    responseSummary: row.responseSummary ?? null,
  };
}

/** App Date vs Postgres `now()` can skew; keep list/stats inclusive of just-inserted rows. */
const QUERY_TO_SKEW_MS = 60_000;

function invocationWhere(filter: { from: Date; to: Date; status?: AiInvocationStatus }): SQL {
  const parts: SQL[] = [
    gte(aiInvocationLogTable.createdAt, filter.from),
    lte(aiInvocationLogTable.createdAt, new Date(filter.to.getTime() + QUERY_TO_SKEW_MS)),
  ];
  if (filter.status) {
    parts.push(eq(aiInvocationLogTable.status, filter.status));
  }
  return and(...parts)!;
}

export async function listInvocations(query: AiInvocationListQuery): Promise<AiInvocationListData> {
  const window = resolveAiInvocationWindow(query);
  const where = invocationWhere({ ...window, status: query.status });
  const offset = (query.page - 1) * query.pageSize;
  const createdAtOrder =
    query.sortOrder === 'asc' ? asc(aiInvocationLogTable.createdAt) : desc(aiInvocationLogTable.createdAt);
  const idOrder = query.sortOrder === 'asc' ? asc(aiInvocationLogTable.id) : desc(aiInvocationLogTable.id);

  const [countRow] = await db.select({ value: count() }).from(aiInvocationLogTable).where(where);
  const total = Number(countRow?.value ?? 0);
  const rows = await db
    .select()
    .from(aiInvocationLogTable)
    .where(where)
    .orderBy(createdAtOrder, idOrder)
    .limit(query.pageSize)
    .offset(offset);

  return {
    items: rows.map(toLog),
    pagination: buildPaginationMeta({
      page: query.page,
      pageSize: query.pageSize,
      total,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
  };
}

export async function getInvocationStats(query: AiInvocationStatsQuery): Promise<AiInvocationStats> {
  const window = resolveAiInvocationWindow(query);
  const where = invocationWhere({ ...window, status: query.status });

  const [row] = await db
    .select({
      inputTokens: sql<string>`coalesce(sum(${aiInvocationLogTable.inputTokens}), 0)`,
      outputTokens: sql<string>`coalesce(sum(${aiInvocationLogTable.outputTokens}), 0)`,
      totalTokens: sql<string>`coalesce(sum(${aiInvocationLogTable.totalTokens}), 0)`,
    })
    .from(aiInvocationLogTable)
    .where(where);

  return {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    costAmount: 0,
    costCurrency: null,
  };
}
