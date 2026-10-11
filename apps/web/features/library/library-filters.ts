import { LIBRARY_ITEMS_LIMIT } from '@gloaming/shared/library';

import { AUTH_ROUTES } from '@/constants';

/** Library source groups are organization views over one Library, never separate libraries. */
export type LibrarySource = 'all' | 'personal' | 'saved';

export type LibraryFilters = {
  source: LibrarySource;
  tagId: string | null;
};

type SearchParamsLike = { get(name: string): string | null } | null | undefined;

const SOURCE_PARAM_VALUES: Record<string, LibrarySource> = {
  all: 'all',
  personal: 'personal',
  saved: 'saved',
  // Legacy internal value kept readable if it ever appears in a shared URL.
  saved_catalog: 'saved',
};

export function normalizeLibrarySource(value: string | null): LibrarySource {
  if (!value) return 'all';
  return SOURCE_PARAM_VALUES[value] ?? 'all';
}

/**
 * Read filters from the URL. Unknown sources fall back to `all`; a tag is only kept when it is a
 * loaded user tag. `validTagIds === null` means tags have not loaded yet, so the raw tag is kept.
 */
export function parseLibraryFilters(
  params: SearchParamsLike,
  validTagIds: readonly string[] | null = null,
): LibraryFilters {
  const source = normalizeLibrarySource(params?.get('source') ?? null);
  const rawTagId = params?.get('tag') ?? null;
  const tagId = rawTagId && (validTagIds === null || validTagIds.includes(rawTagId)) ? rawTagId : null;
  return { source, tagId };
}

/** Serialize filters to a canonical query; defaults are omitted so `/library` stays clean. */
export function buildLibraryFilterQuery(filters: LibraryFilters, currentParams?: URLSearchParams): string {
  const params = new URLSearchParams(currentParams);
  params.delete('source');
  params.delete('tag');
  if (filters.source !== 'all') params.set('source', filters.source);
  if (filters.tagId) params.set('tag', filters.tagId);
  return params.toString();
}

export function isLibraryFilterActive(filters: LibraryFilters): boolean {
  return filters.source !== 'all' || filters.tagId !== null;
}

/**
 * Return the canonical query when the URL itself carries an invalid/redundant source or tag, or
 * `null` when it is already canonical. Keeps normalization independent from optimistic local state.
 */
export function normalizeLibraryFilterSearch(
  filters: LibraryFilters,
  params: SearchParamsLike,
  validTagIds: readonly string[] | null,
): string | null {
  const rawSource = params?.get('source') ?? null;
  const rawTag = params?.get('tag');
  const isSourceNormalizationNeeded =
    rawSource !== null && (normalizeLibrarySource(rawSource) !== rawSource || rawSource === 'all');
  const isTagNormalizationNeeded =
    rawTag != null && (rawTag === '' || (validTagIds !== null && !validTagIds.includes(rawTag)));
  if (!isSourceNormalizationNeeded && !isTagNormalizationNeeded) return null;
  return buildLibraryFilterQuery(filters, params instanceof URLSearchParams ? params : undefined);
}

export function libraryFilterHref(filters: LibraryFilters): string {
  const query = buildLibraryFilterQuery(filters);
  return query ? `${AUTH_ROUTES.library}?${query}` : AUTH_ROUTES.library;
}

/**
 * The Library API caps items below the true Library size, so a full page of items cannot prove that
 * a filtered empty result is authoritative.
 */
export function mayBeTruncated(itemCount: number): boolean {
  return itemCount >= LIBRARY_ITEMS_LIMIT;
}

const APP_ORIGIN = 'https://gloaming.invalid';

/** Accept only an in-app `/library` return target; anything else falls back to the plain Library. */
export function resolveLibraryReturnTo(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return AUTH_ROUTES.library;
  }
  if (/[\\\u0000-\u001f\u007f#]/.test(value)) {
    return AUTH_ROUTES.library;
  }

  let target: URL;
  try {
    target = new URL(value, APP_ORIGIN);
    decodeURIComponent(value);
  } catch {
    return AUTH_ROUTES.library;
  }

  if (target.origin !== APP_ORIGIN || target.pathname !== AUTH_ROUTES.library) {
    return AUTH_ROUTES.library;
  }

  const query = target.searchParams.toString();
  return query ? `${AUTH_ROUTES.library}?${query}` : AUTH_ROUTES.library;
}
