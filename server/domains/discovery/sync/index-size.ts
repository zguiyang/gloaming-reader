/**
 * Stable soft size hint for Discover index rows.
 * Prefer row-count × fixed width over `pg_total_relation_size` (bloat / vacuum noise).
 * Hard admission remains `maxRows`; this only estimates bytes for the budget hint.
 */
export const DISCOVERY_INDEX_BYTES_PER_ROW_HINT = 2_048;

export function estimateIndexBytesFromRowCount(recordCount: number): number {
  if (recordCount <= 0) return 0;
  return recordCount * DISCOVERY_INDEX_BYTES_PER_ROW_HINT;
}
