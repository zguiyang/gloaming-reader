import { describe, expect, it } from 'vitest';

import { getReaderBootstrapCommand } from '@/features/reader/reader-api';

describe('reader bootstrap command', () => {
  it('opens completed state at the resolved part without restarting it', () => {
    expect(
      getReaderBootstrapCommand({
        stateStatus: 'completed',
        resolvedPartId: 'p2',
        preferredPartId: null,
      }),
    ).toEqual({ action: 'open', partId: 'p2' });
    expect(
      getReaderBootstrapCommand({
        stateStatus: 'completed',
        resolvedPartId: 'p1',
        preferredPartId: 'p1',
      }),
    ).toEqual({ action: 'open', partId: 'p1' });
  });
});
