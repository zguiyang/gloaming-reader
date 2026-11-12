/** Stable discovery source identity for Project Gutenberg (on-demand OPDS). */
export const PROJECT_GUTENBERG_SOURCE_KEY = 'project_gutenberg';

/** Adapter/protocol family recorded on the DiscoverySource row. */
export const PROJECT_GUTENBERG_SOURCE_TYPE = 'gutenberg_opds';

/** Official Project Gutenberg OPDS origin. */
export const PROJECT_GUTENBERG_OPDS_ORIGIN = 'https://www.gutenberg.org';

/** Popular / default Discover feed (download-ranked). */
export const PROJECT_GUTENBERG_OPDS_POPULAR_PATH = '/ebooks/search.opds/?sort_order=downloads';

/** OpenSearch-compatible search feed path; append `query=` and optional `start_index=`. */
export const PROJECT_GUTENBERG_OPDS_SEARCH_PATH = '/ebooks/search.opds/';

/** Per-ebook acquisition feed: `/ebooks/{id}.opds`. */
export function projectGutenbergOpdsBookPath(externalId: string): string {
  return `/ebooks/${encodeURIComponent(externalId)}.opds`;
}

/** Category bookshelf acquisition feed: `/ebooks/bookshelf/{id}.opds`. */
export function projectGutenbergOpdsBookshelfPath(bookshelfId: string): string {
  return `/ebooks/bookshelf/${encodeURIComponent(bookshelfId)}.opds`;
}

/** Identifies Gloaming when calling Project Gutenberg OPDS. */
export const PROJECT_GUTENBERG_USER_AGENT = 'Gloaming/0.1 (on-demand OPDS discovery)';

/** Upstream OPDS request timeout. */
export const PROJECT_GUTENBERG_OPDS_TIMEOUT_MS = 20_000;

/** Short TTL for popular / facet list responses (ms). */
export const PROJECT_GUTENBERG_OPDS_CACHE_TTL_MS = 5 * 60_000;

/** OPDS page size reported by Gutenberg (`opensearch:itemsPerPage`). */
export const PROJECT_GUTENBERG_OPDS_PAGE_SIZE = 25;

/** Conventional Project Gutenberg cover candidate URL. */
export function projectGutenbergCoverUrl(externalId: string): string {
  return `https://www.gutenberg.org/cache/epub/${externalId}/pg${externalId}.cover.medium.jpg`;
}
