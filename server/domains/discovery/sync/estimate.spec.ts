import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_INDEX_BYTES_PER_ROW_HINT,
  estimateIndexBytesFromRowCount,
} from '@/server/domains/discovery/sync/index-size';

describe('estimateIndexBytesFromRowCount', () => {
  it('scales linearly from a fixed per-row hint', () => {
    expect(estimateIndexBytesFromRowCount(0)).toBe(0);
    expect(estimateIndexBytesFromRowCount(10_000)).toBe(10_000 * DISCOVERY_INDEX_BYTES_PER_ROW_HINT);
    expect(estimateIndexBytesFromRowCount(10_000)).toBeLessThan(104_857_600);
  });
});
