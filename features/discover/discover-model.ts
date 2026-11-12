import type { SourceRecordItem } from '@/shared/discovery';
import type { CatalogWork } from '@/shared/works';

/**
 * Discover membership only; reading progress is carried by the linked Work and
 * is not exposed by the public SourceRecord contract.
 */
export type DiscoverItem = {
  /** Route identity: Gutenberg external id (or persisted sourceRecordId when present). */
  id: string;
  sourceKey: string;
  externalId: string;
  /** Persisted SourceRecord id after Save; null for pure remote candidates. */
  sourceRecordId: string | null;
  linkedWorkId: string | null;
  detailAvailable: boolean;
  title: string;
  author: string;
  coverImageUrl: string | null;
  isSaveable: boolean;
};

/**
 * Compatibility row for already-published Catalog Works that have no linked
 * SourceRecord.
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

const ENCODED_CONTROL_REF_PATTERN = /&#(?:0*(?:13|10|9)|x0*(?:d|a|9));/gi;
const MARC_SUBFIELD_PATTERN = /(^|\s)\$[a-z](?=\s|$)/g;

export function cleanDiscoverTitle(raw: string): string {
  const cleaned = raw
    .replace(ENCODED_CONTROL_REF_PATTERN, ' ')
    .replace(MARC_SUBFIELD_PATTERN, '$1')
    .replace(/[\u0000-\u001f\u007f\u00a0]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return cleaned || raw.trim();
}

export function formatSourceRecordAuthors(record: Pick<SourceRecordItem, 'authors'>): string {
  return record.authors
    .map((author) => author.name.trim())
    .filter(Boolean)
    .join(', ');
}

export function toDiscoverItem(record: SourceRecordItem): DiscoverItem {
  return {
    id: record.sourceRecordId ?? record.externalId,
    sourceKey: record.sourceKey,
    externalId: record.externalId,
    sourceRecordId: record.sourceRecordId,
    linkedWorkId: record.linkedWorkId,
    detailAvailable: record.detailAvailable === true,
    title: cleanDiscoverTitle(record.title),
    author: formatSourceRecordAuthors(record),
    coverImageUrl: record.coverUrl,
    isSaveable: record.isSaveable,
  };
}

export function toDiscoverLegacyWork(work: CatalogWork, coverImageUrl: string | null): DiscoverLegacyWork {
  return {
    id: work.id,
    title: cleanDiscoverTitle(work.title),
    author: work.author,
    partCount: work.partCount,
    coverImageUrl,
  };
}

export function hasActiveDiscoverFilter(query: string, facetId: string | null): boolean {
  return Boolean(query.trim()) || Boolean(facetId);
}
