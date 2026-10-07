/** Stable discovery source identity for the Project Gutenberg RDF feed (ADR DS-02). */
export const PROJECT_GUTENBERG_SOURCE_KEY = 'project_gutenberg';

/** Adapter/protocol family recorded on the DiscoverySource row. */
export const PROJECT_GUTENBERG_SOURCE_TYPE = 'gutenberg_rdf';

/**
 * Official machine-readable Project Gutenberg metadata snapshot.
 * This is the only upstream feed the adapter reads; it never crawls ebook pages
 * and never downloads EPUB candidates.
 */
export const PROJECT_GUTENBERG_RDF_SNAPSHOT_URL = 'https://www.gutenberg.org/cache/epub/feeds/rdf-files.tar.bz2';

/** Identifies the Gloaming metadata sync when calling the Project Gutenberg feed. */
export const PROJECT_GUTENBERG_USER_AGENT = 'Gloaming/0.1 (metadata sync)';

/** Conservative initial multi-row upsert size; Worker F benchmarks PostgreSQL throughput. */
export const PROJECT_GUTENBERG_UPSERT_BATCH_SIZE = 500;

/** Upper bound for a single decompressed RDF tar member held in memory. */
export const GUTENBERG_TAR_MEMBER_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Decompressed bytes tolerated after the tar terminator (blocking-factor padding).
 * A larger trailing region is treated as a malformed archive instead of being drained forever.
 */
export const GUTENBERG_TAR_TRAILING_MAX_BYTES = 4 * 1024 * 1024;

/** Bounded bzip2 stderr retained for a sanitized operational error summary. */
export const GUTENBERG_BZIP2_STDERR_MAX_BYTES = 4 * 1024;

/** Conventional Project Gutenberg cover candidate URL (never downloaded by this layer). */
export function projectGutenbergCoverUrl(externalId: string): string {
  return `https://www.gutenberg.org/cache/epub/${externalId}/pg${externalId}.cover.medium.jpg`;
}
