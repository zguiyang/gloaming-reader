/**
 * Query-key factory for book detail.
 *
 * Lives outside `book-detail-api` so consumers that already sit upstream of it
 * (the reader invalidates book detail after finishing a work) can share the
 * single definition without importing the module that imports them back.
 */
export const bookDetailQueryKey = {
  all: ['book-detail'] as const,
  detail: (workId: string) => [...bookDetailQueryKey.all, workId] as const,
};
