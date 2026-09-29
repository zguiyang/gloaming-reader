import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertValues = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/infra/db', () => ({
  db: {
    insert: () => ({ values: insertValues }),
  },
}));

import { recordTtsInvocation } from '@/domains/tts/log';

describe('recordTtsInvocation', () => {
  beforeEach(() => insertValues.mockClear());

  it('stores operational fields and a safe failure message', async () => {
    await recordTtsInvocation({
      status: 'failure',
      errorCode: '503',
      source: 'admin.tts_test',
      textLength: 180,
      voice: 'en-US-AriaNeural',
    });

    const row = insertValues.mock.calls[0]?.[0];
    expect(row).toMatchObject({
      errorCode: '503',
      errorMessage: 'TTS invocation failed',
      textLength: 180,
      voice: 'en-US-AriaNeural',
    });
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        'cached',
        'errorCode',
        'errorMessage',
        'id',
        'latencyMs',
        'partId',
        'role',
        'source',
        'status',
        'textLength',
        'userId',
        'voice',
        'workId',
      ].sort(),
    );
  });
});
