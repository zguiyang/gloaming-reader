import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContinueReadingItem, LibraryItem } from '@gloaming/shared/library';
import type { CatalogWork } from '@gloaming/shared/works';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), getLibrary: vi.fn() }));

vi.mock('@/lib/api-request', () => ({
  apiRequest: mocks.apiRequest,
  formatApiError: (error: unknown) => String(error),
}));

vi.mock('@/features/library/library-public', () => ({ getLibrary: mocks.getLibrary }));

import {
  buildDiscoverListQuery,
  discoverQueryKey,
  fetchDiscoverCatalog,
  resolveLibraryStatus,
  toDiscoverItem,
} from '@/features/discover/discover-api';
import { DISCOVER_PAGE_SIZE } from '@/features/discover/discover-model';

function sampleWork(overrides: Partial<CatalogWork> = {}): CatalogWork {
  return {
    id: 'work-1',
    title: 'Sample Title',
    author: '  Jane Austen  ',
    description: 'A published catalog work used in discover card mapping tests.',
    language: 'en',
    processingStatus: 'ready',
    visibility: 'catalog',
    coverAssetId: 'asset-cover-1',
    wordCount: null,
    estimatedMinutes: null,
    suggestedVocabSize: null,
    difficultyScore: null,
    statsProvenance: null,
    publishedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    partCount: 21,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildDiscoverListQuery', () => {
  it('sends pagination, search, and stable sort parameters', () => {
    const params = new URLSearchParams(
      buildDiscoverListQuery({
        page: 2,
        pageSize: DISCOVER_PAGE_SIZE,
        q: 'darwin',
        sortBy: 'createdAt',
        sortOrder: 'asc',
      }),
    );
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe(String(DISCOVER_PAGE_SIZE));
    expect(params.get('q')).toBe('darwin');
    expect(params.get('sortBy')).toBe('createdAt');
    expect(params.get('sortOrder')).toBe('asc');
    expect(params.has('category')).toBe(false);
    expect(params.has('tag')).toBe(false);
  });

  it('provides a query key for the current list parameters', () => {
    expect(discoverQueryKey.list({ page: 2 })).toEqual(['discover', 'list', { page: 2 }]);
  });
});

describe('fetchDiscoverCatalog', () => {
  it('finishes from the public Catalog response without waiting for the Library 401', async () => {
    mocks.apiRequest.mockResolvedValue({
      items: [sampleWork()],
      pagination: {
        page: 1,
        pageSize: DISCOVER_PAGE_SIZE,
        total: 1,
        totalPages: 1,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
    });
    mocks.getLibrary.mockRejectedValue({ status: 401 });

    const result = await fetchDiscoverCatalog({ page: 1, pageSize: DISCOVER_PAGE_SIZE });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'work-1', libraryStatus: 'available' });
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(mocks.getLibrary).not.toHaveBeenCalled();
  });
});

describe('toDiscoverItem', () => {
  it('maps the Catalog list fields and explicit Library state', () => {
    const item = toDiscoverItem(sampleWork());
    expect(item).toMatchObject({
      id: 'work-1',
      title: 'Sample Title',
      author: 'Jane Austen',
      partCount: 21,
      coverImageUrl: '/api/assets/asset-cover-1',
      libraryStatus: 'available',
    });
    expect(item).not.toHaveProperty('tags');
    expect(item).not.toHaveProperty('category');
  });

  it('keeps unsaved Continue Reading progress separate from Library membership', () => {
    const current = {
      work: { id: 'work-1' },
      state: { status: 'in_progress', progressRatio: 12 },
    } as ContinueReadingItem;
    const item = toDiscoverItem(sampleWork(), undefined, current);
    expect(item.libraryStatus).toBe('available');
    expect(item.progressRatio).toBe(12);
  });
});

describe('resolveLibraryStatus', () => {
  it('reports only explicit Library membership', () => {
    expect(resolveLibraryStatus({ state: null } as LibraryItem)).toBe('in_library');
    expect(resolveLibraryStatus()).toBe('available');
  });
});
