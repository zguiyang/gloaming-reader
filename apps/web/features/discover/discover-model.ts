/** Catalog membership only; reading progress is carried separately. */
export type DiscoverLibraryStatus = 'available' | 'in_library';

export type DiscoverItem = {
  id: string;
  title: string;
  author: string;
  /** ReadingPart count for compact catalog cards. */
  partCount: number;
  /** `/api/assets/:id` or null when the work has no cover. */
  coverImageUrl: string | null;
  publishedAt: string;
  libraryStatus: DiscoverLibraryStatus;
  progressRatio: number | null;
};

/** 3 rows × 5 columns on large screens. */
export const DISCOVER_PAGE_SIZE = 15;
