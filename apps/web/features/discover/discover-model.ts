import type { PublicCategorySummary, SourceRecordItem } from '@gloaming/shared/discovery';
import type { CatalogWork } from '@gloaming/shared/works';

/**
 * Discover membership only; reading progress is carried by the linked Work and
 * is not exposed by the public SourceRecord contract.
 */
export type DiscoverItem = {
  /** Stable Discover identity: `sourceRecordId`, never a `reading_work.id`. */
  id: string;
  /** Linked readable `reading_work.id`, or null before materialization. */
  linkedWorkId: string | null;
  /**
   * Server decision: can this viewer open the linked Work's detail page?
   * Only `true` may render a detail entry; anything missing or falsy (older
   * payloads, stale caches) is treated as `false` so Discover never links to a
   * 404. Saving/pending/failed states are gated separately by the card.
   */
  detailAvailable: boolean;
  title: string;
  author: string;
  /** Upstream cover URL, or null when the SourceRecord has no cover. */
  coverImageUrl: string | null;
  /** Minimal localized category summaries projected for the request locale. */
  categories: PublicCategorySummary[];
  /**
   * Whether a selectable official EPUB candidate exists in synced metadata.
   * `false` disables saving for now (for example an audio-only source or a
   * record with no EPUB); the record remains listed in Discover.
   */
  isSaveable: boolean;
};

/**
 * Compatibility row for already-published Catalog Works that have no linked
 * SourceRecord. It keeps `reading_work.id` because that is the only readable
 * identity; it is never presented as a SourceRecord.
 */
export type DiscoverLegacyWork = {
  id: string;
  title: string;
  author: string;
  partCount: number;
  coverImageUrl: string | null;
};

/** 3 rows × 5 columns on large screens. */
export const DISCOVER_PAGE_SIZE = 15;

/** Literal numeric character references for CR/LF/tab that appear encoded in upstream titles. */
const ENCODED_CONTROL_REF_PATTERN = /&#(?:0*(?:13|10|9)|x0*(?:d|a|9));/gi;

/**
 * Confidently delimited MARC-like subfield tokens only: a lowercase
 * single-letter code that forms a whitespace-delimited token (its own leading
 * whitespace, or the start of the string) and is followed by whitespace or the
 * end of the string — e.g. a leading `$a ` or a trailing ` $h`. Everything
 * ambiguous is preserved: `$budget`, `$USD`, `$US`, `$A`, `$500`,
 * `$cappella`, an embedded `Hobbit$bor` or `Middlemarch$c`, and double-dollar
 * forms such as `$$b` all stay intact.
 */
const MARC_SUBFIELD_PATTERN = /(^|\s)\$[a-z](?=\s|$)/g;

/**
 * Display-only cleanup for upstream book titles. Bibliographic feeds sometimes
 * carry literal encoded line breaks (`&#13;`, `&#10;`), real control
 * characters, or whitespace-delimited MARC-style subfield tokens (` $a `, a
 * trailing ` $h`) in the title. Dollar sequences that plausibly belong to the
 * title (`$budget`, `$USD`, `$A`, `$500`) are preserved. This fixes
 * only what Discover renders — the SourceRecord and Catalog Work are never
 * modified — and it never decodes or injects HTML: every other character
 * (including `&amp;` or `<`) stays literal text.
 */
export function cleanDiscoverTitle(raw: string): string {
  const cleaned = raw
    .replace(ENCODED_CONTROL_REF_PATTERN, ' ')
    .replace(MARC_SUBFIELD_PATTERN, '$1')
    // Real control characters, tabs, line breaks, and non-breaking spaces.
    .replace(/[\u0000-\u001f\u007f\u00a0]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  // A title that cleans down to nothing still needs something readable.
  return cleaned || raw.trim();
}

/** Comma-joined SourceRecord author display names; empty when the source has none. */
export function formatSourceRecordAuthors(record: Pick<SourceRecordItem, 'authors'>): string {
  return record.authors
    .map((author) => author.name.trim())
    .filter(Boolean)
    .join(', ');
}

export function toDiscoverItem(record: SourceRecordItem): DiscoverItem {
  return {
    id: record.sourceRecordId,
    linkedWorkId: record.linkedWorkId,
    // Defensive: a payload that predates the field must never open an entry.
    detailAvailable: record.detailAvailable === true,
    title: cleanDiscoverTitle(record.title),
    author: formatSourceRecordAuthors(record),
    coverImageUrl: record.coverUrl ?? null,
    categories: record.categories ?? [],
    isSaveable: record.isSaveable,
  };
}

/**
 * Safe localized category label. Public summaries are already resolved for the
 * request locale by the backend; this only guarantees a non-empty chip when a
 * label is unexpectedly blank.
 */
export function categoryDisplayName(category: PublicCategorySummary): string {
  const name = category.name.trim();
  return name || category.id;
}

/** True when a category or non-empty query narrows the current Discover list. */
export function hasActiveDiscoverFilter(input: { query: string; categoryId: string | null }): boolean {
  return input.categoryId !== null || input.query.trim() !== '';
}

/** Maps a published Catalog Work into the compatibility card row. */
export function toDiscoverLegacyWork(work: CatalogWork, coverImageUrl: string | null): DiscoverLegacyWork {
  return {
    id: work.id,
    title: cleanDiscoverTitle(work.title),
    author: work.author.trim(),
    partCount: work.partCount,
    coverImageUrl,
  };
}
