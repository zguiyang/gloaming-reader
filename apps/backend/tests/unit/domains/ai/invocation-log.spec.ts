import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertValues = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/infra/db', () => ({
  db: {
    insert: () => ({ values: insertValues }),
  },
}));

import { recordInvocation } from '@/domains/ai/invocations/log';

describe('recordInvocation', () => {
  beforeEach(() => insertValues.mockClear());

  it('stores allowlisted operational summaries and a safe failure message', async () => {
    await recordInvocation({
      status: 'failure',
      errorCode: '503',
      source: 'assist.ask',
      requestSummary: { messageCount: 2, actionId: 'meaning', privateBody: 'private request' } as never,
      responseSummary: { replyLength: 24, privateBody: 'private response' } as never,
    });

    const row = insertValues.mock.calls[0]?.[0];
    expect(row).toMatchObject({
      errorCode: '503',
      errorMessage: 'AI invocation failed',
      requestSummary: { messageCount: 2, actionId: 'meaning' },
      responseSummary: { replyLength: 24 },
    });
    expect(JSON.stringify(row)).not.toContain('private request');
    expect(JSON.stringify(row)).not.toContain('private response');
  });
});
