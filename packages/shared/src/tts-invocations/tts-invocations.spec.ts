import { describe, expect, it } from 'vitest';

import { ttsInvocationLogSchema } from './tts-invocations.ts';

describe('tts invocation log schema', () => {
  it('keeps operational fields and strips unrecognized content', () => {
    const parsed = ttsInvocationLogSchema.parse({
      id: 'tts_log_1',
      createdAt: '2026-08-13T12:00:00.000Z',
      status: 'success',
      errorCode: null,
      errorMessage: null,
      source: 'admin.tts_test',
      userId: null,
      workId: null,
      partId: null,
      partTitle: null,
      voice: 'en-US-AriaNeural',
      role: 'us',
      textLength: 42,
      latencyMs: 120,
      cached: false,
      privateBody: 'private speech input',
    });

    expect(parsed.textLength).toBe(42);
    expect(JSON.stringify(parsed)).not.toContain('private speech input');
    expect(parsed).not.toHaveProperty('privateBody');
  });
});
