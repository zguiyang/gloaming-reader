/** Stable discovery source identity for Project Gutenberg. */
export const PROJECT_GUTENBERG_SOURCE_KEY = 'project_gutenberg';

/**
 * Adapter family for the bounded catalog index (CSV staging + Top-N promote).
 * OPDS helpers below remain for optional enrich / legacy paths.
 * RDF dump helpers remain for a future popularity overlay.
 */
export const PROJECT_GUTENBERG_SOURCE_TYPE = 'gutenberg_catalog_index';

/**
 * Official weekly CSV catalog (lightweight book list).
 * Prefer the PGLAF mirror — www.gutenberg.org often resets long downloads.
 * Sync never crawls HTML and never downloads EPUB bytes.
 */
export const PROJECT_GUTENBERG_CSV_SNAPSHOT_URL = 'https://gutenberg.pglaf.org/cache/epub/feeds/pg_catalog.csv.gz';

/**
 * Full RDF metadata archive (daily). Kept for a future downloads/popularity overlay;
 * not the v1 sync primary path.
 */
export const PROJECT_GUTENBERG_RDF_SNAPSHOT_URL = 'https://gutenberg.pglaf.org/cache/epub/feeds/rdf-files.tar.bz2';

/** Hard wall-clock limit for one background catalog sync run (CSV + promote). */
export const PROJECT_GUTENBERG_SYNC_TIMEOUT_MS = 15 * 60 * 1000;

/** A `queued` claim older than this is treated as lost. */
export const PROJECT_GUTENBERG_STALE_QUEUED_MS = 10 * 60 * 1000;

/**
 * A `syncing` run older than this is treated as lost. Kept above the run
 * timeout plus a grace window so a live run is never misjudged.
 */
export const PROJECT_GUTENBERG_STALE_SYNCING_MS = PROJECT_GUTENBERG_SYNC_TIMEOUT_MS + 15 * 60 * 1000;

/** Upper bound for a single decompressed RDF tar member held in memory. */
export const GUTENBERG_TAR_MEMBER_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Decompressed bytes tolerated after the tar terminator (blocking-factor padding).
 */
export const GUTENBERG_TAR_TRAILING_MAX_BYTES = 4 * 1024 * 1024;

/** Bounded bzip2 stderr retained for a sanitized operational error summary. */
export const GUTENBERG_BZIP2_STDERR_MAX_BYTES = 4 * 1024;

/** Default max indexed rows for the Project Gutenberg source (v1). */
export const PROJECT_GUTENBERG_DEFAULT_MAX_ROWS = 10_000;

/** Soft Postgres budget hint for Discover index data (bytes). */
export const PROJECT_GUTENBERG_DEFAULT_BUDGET_BYTES = 100 * 1024 * 1024;

/** Weekly catalog sync cron (UTC, Sunday 02:00) — CSV upstream is weekly. */
export const PROJECT_GUTENBERG_SYNC_CRON_PATTERN = '0 2 * * 0';

/** BullMQ job scheduler id for the Gutenberg catalog sync (pattern may change via upsert). */
export const PROJECT_GUTENBERG_SYNC_SCHEDULER_ID = 'discovery-sync-project-gutenberg-daily';

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

/** Identifies Gloaming when calling Project Gutenberg (RDF sync or OPDS). */
export const PROJECT_GUTENBERG_USER_AGENT = 'Gloaming/0.1 (catalog sync; OPDS fallback)';

/** Upstream OPDS request timeout. */
export const PROJECT_GUTENBERG_OPDS_TIMEOUT_MS = 20_000;

/** Short TTL for popular / facet list responses (ms). */
export const PROJECT_GUTENBERG_OPDS_CACHE_TTL_MS = 5 * 60_000;

/** OPDS page size reported by Gutenberg (`opensearch:itemsPerPage`). */
export const PROJECT_GUTENBERG_OPDS_PAGE_SIZE = 25;

/**
 * Cover files live under the same generated-cache path on every PG mirror.
 * Prefer PGLAF for browser display — `www.gutenberg.org` often returns 503
 * from restricted networks while the mirror serves the identical object.
 */
export const PROJECT_GUTENBERG_COVER_ORIGIN = 'https://gutenberg.pglaf.org';

/** Conventional Project Gutenberg cover candidate URL (mirror host). */
export function projectGutenbergCoverUrl(externalId: string): string {
  return `${PROJECT_GUTENBERG_COVER_ORIGIN}/cache/epub/${encodeURIComponent(externalId)}/pg${encodeURIComponent(externalId)}.cover.medium.jpg`;
}

/**
 * Rewrite a stored www.gutenberg.org cover URL onto the cover mirror.
 * Leaves non-Gutenberg hosts and non-URL strings unchanged.
 */
export function rewriteGutenbergCoverUrlToMirror(coverUrl: string | null | undefined): string | null {
  if (!coverUrl) return null;
  try {
    const parsed = new URL(coverUrl);
    if (parsed.hostname === 'www.gutenberg.org' || parsed.hostname === 'gutenberg.org') {
      parsed.protocol = 'https:';
      parsed.hostname = 'gutenberg.pglaf.org';
      return parsed.toString();
    }
  } catch {
    return coverUrl;
  }
  return coverUrl;
}

/**
 * Conventional images EPUB on the generated-cache path.
 * Prefer the PGLAF mirror — `www.gutenberg.org` is often unreachable, and
 * `/ebooks/{id}.epub.images` is not mirrored on PGLAF (404); the cache object is.
 */
export function projectGutenbergEpubImagesUrl(externalId: string): string {
  const id = encodeURIComponent(externalId);
  return `${PROJECT_GUTENBERG_COVER_ORIGIN}/cache/epub/${id}/pg${id}-images.epub`;
}

/**
 * Gutenberg search/browse OPDS feeds attach the same catalog icon as every
 * entry's "thumbnail". Treat it as no cover so list cards fall back to the
 * per-ebook `cache/epub/{id}/pg{id}.cover.medium.jpg` URL (detail feeds already
 * expose that image).
 */
export function isGutenbergCatalogPlaceholderCover(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('/gutenberg/kdict.png') || pathname.endsWith('/kdict.png');
  } catch {
    return /(?:^|\/)kdict\.png(?:\?|$)/i.test(url);
  }
}
