import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publicCategoryListDataSchema, sourceRecordListDataSchema } from '@gloaming/shared/discovery';
import { sourceRecordSaveResultSchema } from '@gloaming/shared/library';
import { catalogListDataSchema } from '@gloaming/shared/works';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/lib/api-request', () => ({
  apiRequest: mocks.apiRequest,
  formatApiError: (error: unknown) => String(error),
}));

import {
  buildDiscoverLegacyQuery,
  buildDiscoverRecordsQuery,
  discoverQueryKey,
  fetchDiscoverCategories,
  fetchDiscoverLegacyWorks,
  fetchDiscoverRecords,
  saveSourceRecordToLibrary,
} from '@/features/discover/discover-api';
import { DISCOVER_PAGE_SIZE } from '@/features/discover/discover-model';

function paramsOf(call: unknown[]): URLSearchParams {
  const path = String(call[0]);
  return new URLSearchParams(path.slice(path.indexOf('?') + 1));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiRequest.mockResolvedValue({ items: [], pagination: {} });
});

describe('buildDiscoverRecordsQuery', () => {
  it('sends pagination, stable SourceRecord sort, search, and category filter', () => {
    const params = new URLSearchParams(
      buildDiscoverRecordsQuery({ page: 2, pageSize: DISCOVER_PAGE_SIZE, q: 'darwin', categoryId: 'cat-1' }),
    );
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe(String(DISCOVER_PAGE_SIZE));
    expect(params.get('sortBy')).toBe('sourceUpdatedAt');
    expect(params.get('sortOrder')).toBe('desc');
    expect(params.get('q')).toBe('darwin');
    expect(params.get('categoryId')).toBe('cat-1');
    expect(params.has('language')).toBe(false);
    expect(params.has('sourceLink')).toBe(false);
  });

  it('omits blank search and category filters', () => {
    const params = new URLSearchParams(buildDiscoverRecordsQuery({ page: 1 }));
    expect(params.has('q')).toBe(false);
    expect(params.has('categoryId')).toBe(false);
  });

  it('provides a query key for the current list parameters', () => {
    expect(discoverQueryKey.records({ page: 2 })).toEqual(['discover', 'records', { page: 2 }]);
  });
});

describe('buildDiscoverLegacyQuery', () => {
  it('reads only published Catalog Works without a SourceRecord link', () => {
    const params = new URLSearchParams(buildDiscoverLegacyQuery({ page: 1, q: 'austen' }));
    expect(params.get('sourceLink')).toBe('unlinked');
    expect(params.get('sortBy')).toBe('publishedAt');
    expect(params.get('q')).toBe('austen');
  });
});

describe('Discover API clients', () => {
  it('reads the SourceRecord list through its public contract', async () => {
    await fetchDiscoverRecords({ page: 1, pageSize: DISCOVER_PAGE_SIZE, categoryId: 'cat-9' });
    const call = mocks.apiRequest.mock.calls[0]!;
    expect(String(call[0])).toContain('/api/discover/records?');
    expect(paramsOf(call).get('categoryId')).toBe('cat-9');
    expect(call[1]).toMatchObject({ schema: sourceRecordListDataSchema });
  });

  it('reads localized public categories', async () => {
    await fetchDiscoverCategories();
    const call = mocks.apiRequest.mock.calls[0]!;
    expect(String(call[0])).toBe('/api/discover/categories');
    expect(call[1]).toMatchObject({ schema: publicCategoryListDataSchema });
  });

  it('uses the compatibility Catalog contract for unlinked Works', async () => {
    await fetchDiscoverLegacyWorks({ page: 1 });
    const call = mocks.apiRequest.mock.calls[0]!;
    expect(String(call[0])).toContain('/api/catalog/works?');
    expect(paramsOf(call).get('sourceLink')).toBe('unlinked');
    expect(call[1]).toMatchObject({ schema: catalogListDataSchema });
  });

  it('creates an explicit SourceRecord Save Intent without auto-save', async () => {
    await saveSourceRecordToLibrary('source record/1');
    const call = mocks.apiRequest.mock.calls[0]!;
    expect(String(call[0])).toBe('/api/library/source-records/source%20record%2F1');
    expect(call[1]).toMatchObject({ method: 'POST', schema: sourceRecordSaveResultSchema });
  });
});
