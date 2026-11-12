import type { DiscoveryFacet, SourceRecordDetail, SourceRecordItem, SourceRecordListData } from '@/shared/discovery';
import { DEFAULT_SOURCE_RECORD_SORT_BY, DISCOVERY_DEFAULT_LANGUAGE } from '@/shared/discovery';
import { DEFAULT_SORT_ORDER } from '@/shared/pagination';

import { hasSelectableEpubCandidate } from '@/server/domains/discovery/materialization/epub-candidate';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';
import { HTTP_STATUS } from '@/server/shared/constants';

import { GUTENBERG_CATEGORY_BOOKSHELVES, getGutenbergCategoryBookshelf } from './category-bookshelves';
import {
  PROJECT_GUTENBERG_OPDS_CACHE_TTL_MS,
  PROJECT_GUTENBERG_OPDS_PAGE_SIZE,
  PROJECT_GUTENBERG_OPDS_POPULAR_PATH,
  PROJECT_GUTENBERG_OPDS_SEARCH_PATH,
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SOURCE_TYPE,
  projectGutenbergCoverUrl,
  projectGutenbergOpdsBookPath,
  projectGutenbergOpdsBookshelfPath,
} from './constants';
import { fetchGutenbergOpdsFeed, GutenbergOpdsError, type OpdsFeedEntry } from './opds-client';

type CacheEntry<T> = { readonly expiresAt: number; readonly value: T };

const responseCache = new Map<string, CacheEntry<unknown>>();

function readCache<T>(key: string): T | null {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return hit.value as T;
}

function writeCache<T>(key: string, value: T): T {
  responseCache.set(key, { expiresAt: Date.now() + PROJECT_GUTENBERG_OPDS_CACHE_TTL_MS, value });
  return value;
}

async function cachedFeed(cacheKey: string, path: string) {
  const cached = readCache<Awaited<ReturnType<typeof fetchGutenbergOpdsFeed>>>(cacheKey);
  if (cached) return cached;
  const page = await fetchGutenbergOpdsFeed(path);
  return writeCache(cacheKey, page);
}

function startIndexForPage(page: number, pageSize: number): number {
  return (Math.max(1, page) - 1) * pageSize + 1;
}

function toCandidateItem(entry: OpdsFeedEntry, opts?: { detailCandidates?: boolean }): SourceRecordItem {
  const candidates = entry.contentCandidates;
  const isSaveable = opts?.detailCandidates ? hasSelectableEpubCandidate({ contentCandidates: candidates }) : true;
  return {
    sourceRecordId: null,
    linkedWorkId: null,
    sourceId: null,
    sourceKey: PROJECT_GUTENBERG_SOURCE_KEY,
    sourceType: PROJECT_GUTENBERG_SOURCE_TYPE,
    externalId: entry.externalId,
    title: entry.title,
    authors: entry.authors,
    languages: entry.languages,
    description: entry.description,
    coverUrl: entry.coverUrl ?? projectGutenbergCoverUrl(entry.externalId),
    availability: 'available',
    sourceUpdatedAt: entry.sourceUpdatedAt,
    lastSeenAt: null,
    createdAt: null,
    updatedAt: null,
    isSaveable,
    detailAvailable: false,
  };
}

function toCandidateDetail(entry: OpdsFeedEntry): SourceRecordDetail {
  const item = toCandidateItem(entry, { detailCandidates: true });
  return {
    ...item,
    rightsStatement: entry.rightsStatement,
    contentCandidates: entry.contentCandidates,
    sourceMeta: {
      ...(entry.subjects.length > 0 ? { subjects: entry.subjects } : {}),
      ...(entry.bookshelves.length > 0 ? { bookshelves: entry.bookshelves } : {}),
      ...(entry.description ? { summary: entry.description } : {}),
    },
  };
}

function mapOpdsError(error: unknown): never {
  if (error instanceof GutenbergOpdsError) {
    if (error.status === 404) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
    }
    throw new AppError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }
  throw error;
}

export function listGutenbergDiscoveryFacets(): DiscoveryFacet[] {
  return GUTENBERG_CATEGORY_BOOKSHELVES.map((item) => ({
    id: item.id,
    name: item.name,
    sourceKey: PROJECT_GUTENBERG_SOURCE_KEY,
  }));
}

export async function listGutenbergOpdsRecords(input: {
  page: number;
  pageSize: number;
  q?: string;
  facetId?: string;
  language?: string;
}): Promise<SourceRecordListData> {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(Math.max(1, input.pageSize), PROJECT_GUTENBERG_OPDS_PAGE_SIZE);
  const startIndex = startIndexForPage(page, PROJECT_GUTENBERG_OPDS_PAGE_SIZE);
  const language = (input.language ?? DISCOVERY_DEFAULT_LANGUAGE).toLowerCase();

  let path: string;
  let cacheKey: string;

  if (input.q?.trim()) {
    const query = new URLSearchParams({
      query: input.q.trim(),
      start_index: String(startIndex),
    });
    path = `${PROJECT_GUTENBERG_OPDS_SEARCH_PATH}?${query.toString()}`;
    cacheKey = `search:${language}:${query.toString()}`;
  } else if (input.facetId) {
    const shelf = getGutenbergCategoryBookshelf(input.facetId);
    if (!shelf) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
    }
    const query = startIndex > 1 ? `?start_index=${startIndex}` : '';
    path = `${projectGutenbergOpdsBookshelfPath(shelf.id)}${query}`;
    cacheKey = `facet:${shelf.id}:${startIndex}`;
  } else {
    const query = startIndex > 1 ? `&start_index=${startIndex}` : '';
    path = `${PROJECT_GUTENBERG_OPDS_POPULAR_PATH}${query}`;
    cacheKey = `popular:${startIndex}`;
  }

  try {
    const feed = await cachedFeed(cacheKey, path);
    let entries = feed.entries;
    if (language) {
      const filtered = entries.filter((entry) => entry.languages.some((code) => code.toLowerCase() === language));
      // List feeds often omit language; keep unfiltered when every entry lacks a match signal.
      if (filtered.length > 0 || entries.every((entry) => entry.languages.length > 0)) {
        entries = filtered.length > 0 ? filtered : entries;
      }
    }

    const items = entries.slice(0, pageSize).map((entry) => toCandidateItem(entry));
    return {
      items,
      hasMore: feed.hasMore,
      pagination: {
        page,
        pageSize,
        total: feed.hasMore ? page * pageSize + 1 : (page - 1) * pageSize + items.length,
        totalPages: feed.hasMore ? page + 1 : page,
        sortBy: DEFAULT_SOURCE_RECORD_SORT_BY,
        sortOrder: DEFAULT_SORT_ORDER,
      },
    };
  } catch (error) {
    mapOpdsError(error);
  }
}

export async function getGutenbergOpdsRecord(externalId: string): Promise<SourceRecordDetail> {
  const id = externalId.trim();
  if (!/^\d+$/.test(id)) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }
  try {
    const feed = await cachedFeed(`book:${id}`, projectGutenbergOpdsBookPath(id));
    const entry =
      feed.entries.find((item) => item.externalId === id) ??
      feed.entries.find((item) => item.contentCandidates.length > 0) ??
      feed.entries[0];
    if (!entry) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
    }
    // Book feeds may repeat the same title with different formats; merge EPUB candidates.
    const mergedCandidates = feed.entries.flatMap((item) => item.contentCandidates);
    const unique = new Map(mergedCandidates.map((candidate) => [candidate.url, candidate]));
    return toCandidateDetail({
      ...entry,
      contentCandidates: [...unique.values()],
    });
  } catch (error) {
    mapOpdsError(error);
  }
}
