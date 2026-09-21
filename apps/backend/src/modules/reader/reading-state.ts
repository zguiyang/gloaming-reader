import type { readingState as readingStateTable } from '@gloaming/db';
import {
  computeChapterProgress,
  NO_CHAPTERS_COMPLETED,
  type PartSortOrder,
  type ReadingState,
} from '@gloaming/shared/reader';

export type ReadingStateRow = typeof readingStateTable.$inferSelect;

function toIso(value: Date): string {
  return value.toISOString();
}

export function toReadingState(row: ReadingStateRow, parts: PartSortOrder[]): ReadingState {
  const partSortOrders = parts.map((part) => ({ sortOrder: part.sortOrder }));
  const completedThrough = row.completedThroughSortOrder ?? NO_CHAPTERS_COMPLETED;
  return {
    status: row.status as ReadingState['status'],
    currentPartId: row.currentPartId,
    completedThroughSortOrder: completedThrough,
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
