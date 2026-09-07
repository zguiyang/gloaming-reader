import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE, DEFAULT_SORT_ORDER } from '../pagination/index.ts';
import {
  AI_INVOCATION_DEFAULT_PAGE_SIZE,
  AI_INVOCATION_STATS_DAYS,
  aiInvocationListQuerySchema,
  aiInvocationLogSchema,
  aiInvocationStatsQuerySchema,
  aiInvocationStatsSchema,
  aiInvocationWindowForDays,
  DEFAULT_AI_INVOCATION_SORT_BY,
  resolveAiInvocationWindow,
} from './ai-invocations.ts';

describe('ai invocation list query', () => {
  it('defaults to page 1, 20 rows, createdAt desc, no extra filters', () => {
    expect(aiInvocationListQuerySchema.parse({})).toEqual({
      page: DEFAULT_PAGE,
      pageSize: AI_INVOCATION_DEFAULT_PAGE_SIZE,
      sortOrder: DEFAULT_SORT_ORDER,
      sortBy: DEFAULT_AI_INVOCATION_SORT_BY,
    });
    expect(AI_INVOCATION_DEFAULT_PAGE_SIZE).toBe(10);
  });

  it('coerces pageSize and rejects non-positive values', () => {
    expect(aiInvocationListQuerySchema.parse({ pageSize: '5' }).pageSize).toBe(5);
    expect(aiInvocationListQuerySchema.safeParse({ pageSize: '0' }).success).toBe(false);
  });

  it('accepts from/to ISO timestamps and status', () => {
    const parsed = aiInvocationListQuerySchema.parse({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-13T12:00:00.000Z',
      status: 'failure',
    });
    expect(parsed.from?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(parsed.to?.toISOString()).toBe('2026-08-13T12:00:00.000Z');
    expect(parsed.status).toBe('failure');
  });

  it('rejects a reversed range', () => {
    expect(
      aiInvocationListQuerySchema.safeParse({
        from: '2026-08-13T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('ai invocation window helpers', () => {
  it('defaults to the last 30 days when from/to are omitted', () => {
    const now = new Date('2026-08-13T12:00:00.000Z');
    const window = resolveAiInvocationWindow({}, now);
    expect(window.to.toISOString()).toBe(now.toISOString());
    expect(window.from.toISOString()).toBe(aiInvocationWindowForDays(AI_INVOCATION_STATS_DAYS, now).from.toISOString());
  });
});

describe('ai invocation log schema', () => {
  it('accepts a success row with nullable cost', () => {
    const parsed = aiInvocationLogSchema.parse({
      id: 'log_1',
      createdAt: '2026-08-13T12:00:00.000Z',
      status: 'success',
      errorCode: null,
      errorMessage: null,
      purpose: 'assist',
      source: 'assist.ask',
      userId: null,
      refType: 'reading_work',
      refId: 'work_1',
      modelRowId: null,
      providerId: null,
      modelId: 'gpt-4.1-mini',
      baseUrl: null,
      latencyMs: 120,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costAmount: null,
      costCurrency: null,
      requestSummary: { actionId: 'meaning', messageCount: 2 },
      responseSummary: { replyPreview: 'hello', replyLength: 5 },
    });
    expect(parsed.source).toBe('assist.ask');
    expect(parsed.purpose).toBe('assist');
    expect(parsed.costAmount).toBeNull();
  });
});

describe('ai invocation stats schema', () => {
  it('accepts a window with numeric cost placeholder', () => {
    const parsed = aiInvocationStatsSchema.parse({
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-08-13T00:00:00.000Z',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costAmount: 0,
      costCurrency: null,
    });
    expect(parsed.costAmount).toBe(0);
    expect(aiInvocationStatsQuerySchema.parse({ status: 'success' }).status).toBe('success');
  });
});
