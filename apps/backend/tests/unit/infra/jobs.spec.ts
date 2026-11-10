import { describe, expect, it } from 'vitest';

import { processPing } from '@/application/jobs/ping';

describe('processPing', () => {
  it('echoes requestedAt', () => {
    expect(processPing({ requestedAt: '2026-08-19T01:00:00.000Z' })).toEqual({
      ok: true,
      requestedAt: '2026-08-19T01:00:00.000Z',
    });
  });
});
