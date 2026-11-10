import type { readingState as readingStateTable } from '@gloaming/db';
import {
  computeChapterProgress,
  NO_CHAPTERS_COMPLETED,
  type PartSortOrder,
  READING_STATE_ANCHOR_KIND,
  type ReadingAnchor,
  readingAnchorSchema,
  type ReadingState,
} from '@gloaming/shared/reader';

export type ReadingStateRow = typeof readingStateTable.$inferSelect;

function toIso(value: Date): string {
  return value.toISOString();
}

/**
 * Decode the stored anchor only when its part still matches `current_part_id`.
 * A mismatched or malformed anchor is treated as absent so it can never be
 * applied to a different chapter.
 */
export function decodeReadingAnchor(row: ReadingStateRow): ReadingAnchor | null {
  if (row.anchorKind !== READING_STATE_ANCHOR_KIND || !row.anchorValue || !row.currentPartId) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.anchorValue);
  } catch {
    return null;
  }
  const anchor = readingAnchorSchema.safeParse(parsed);
  if (!anchor.success || anchor.data.partId !== row.currentPartId) {
    return null;
  }
  return anchor.data;
}

export function toReadingState(row: ReadingStateRow, parts: PartSortOrder[]): ReadingState {
  const partSortOrders = parts.map((part) => ({ sortOrder: part.sortOrder }));
  const completedThrough = row.completedThroughSortOrder ?? NO_CHAPTERS_COMPLETED;
  return {
    status: row.status as ReadingState['status'],
    currentPartId: row.currentPartId,
    completedThroughSortOrder: completedThrough,
    anchor: decodeReadingAnchor(row),
    revision: row.revision,
    progressRatio: computeChapterProgress({
      status: row.status as ReadingState['status'],
      completedThroughSortOrder: completedThrough,
      parts: partSortOrders,
    }),
    totalPartCount: parts.length,
    lastReadAt: toIso(row.lastReadAt),
    completedAt: row.completedAt ? toIso(row.completedAt) : null,
  };
}
