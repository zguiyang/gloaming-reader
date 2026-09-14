/** Catalog membership relative to the reader's shelf. */
export type DiscoverShelfStatus = 'available' | 'on_shelf' | 'in_progress';

export type DiscoverItem = {
  id: string;
  title: string;
  author: string;
  /** ReadingPart count for compact catalog cards. */
  partCount: number;
  tags: string[];
  /** `/api/assets/:id` or null when the work has no cover. */
  coverImageUrl: string | null;
  publishedAt: string;
  shelfStatus: DiscoverShelfStatus;
  progressRatio: number | null;
};

/** 3 rows × 5 columns on large screens. */
export const DISCOVER_PAGE_SIZE = 15;

/** Locale-neutral sentinel for the “all tags” filter chip. */
export const DISCOVER_ALL_TAG = '__all__' as const;
export type DiscoverTagFilter = typeof DISCOVER_ALL_TAG | string;
