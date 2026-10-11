import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publicCategoryManagementItemSchema } from '@gloaming/shared/discovery';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/lib/api-request', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

import {
  assignCategoryToSourceRecord,
  buildAssignmentCandidateQuery,
  buildCategoryRecordListQuery,
  createManagedCategory,
  isCategoryAssignmentLimitError,
  isCategoryNameCollisionError,
  listCategorySourceRecords,
  listManagedCategories,
  publicCategoriesQueryKey,
  searchAssignableSourceRecords,
  unassignCategoryFromSourceRecord,
  updateManagedCategoryLabel,
} from '@/features/admin/public-categories/public-categories-api';
import {
  PUBLIC_CATEGORY_ASSIGNMENT_SEARCH_SIZE,
  PUBLIC_CATEGORY_LIMIT_EXCEEDED_CODE,
  PUBLIC_CATEGORY_NAME_EXISTS_CODE,
  PUBLIC_CATEGORY_RECORD_PAGE_SIZE,
} from '@/features/admin/public-categories/public-categories-model';
import { ApiRequestError } from '@/lib/api-request';

function callArgs(index = 0): [string, Record<string, unknown>] {
  return mocks.apiRequest.mock.calls[index] as [string, Record<string, unknown>];
}

function queryOf(path: string): URLSearchParams {
  return new URLSearchParams(path.slice(path.indexOf('?') + 1));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiRequest.mockResolvedValue(undefined);
});

describe('query builders', () => {
  it('sends admin record pagination, stable sort, and optional search', () => {
    const params = queryOf('?' + buildCategoryRecordListQuery({ page: 2, q: '  austen  ' }));
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe(String(PUBLIC_CATEGORY_RECORD_PAGE_SIZE));
    expect(params.get('sortBy')).toBe('sourceUpdatedAt');
    expect(params.get('sortOrder')).toBe('desc');
    expect(params.get('q')).toBe('austen');
  });

  it('omits a blank admin record search', () => {
    expect(queryOf('?' + buildCategoryRecordListQuery({ page: 1, q: '   ' })).has('q')).toBe(false);
  });

  it('builds a bounded candidate query over the admin SourceRecord list', () => {
    const params = queryOf('?' + buildAssignmentCandidateQuery('  darwin '));
    expect(params.get('q')).toBe('darwin');
    expect(params.get('page')).toBe('1');
    expect(params.get('pageSize')).toBe(String(PUBLIC_CATEGORY_ASSIGNMENT_SEARCH_SIZE));
    expect(params.get('sortBy')).toBe('sourceUpdatedAt');
  });
});

describe('category API clients', () => {
  it('lists managed categories through the PC-02 admin route', async () => {
    mocks.apiRequest.mockResolvedValue([]);
    await listManagedCategories();
    const [path, options] = callArgs();
    expect(path).toBe('/api/admin/discovery/categories');
    expect(options).toMatchObject({ schema: expect.anything() });
    expect(options.method).toBeUndefined();
  });

  it('creates a category with name and locale only — no Provider is involved', async () => {
    await createManagedCategory({ name: '科幻', locale: 'zh-CN' });
    const [path, options] = callArgs();
    expect(path).toBe('/api/admin/discovery/categories');
    expect(options.method).toBe('POST');
    expect(options.json).toEqual({ name: '科幻', locale: 'zh-CN' });
    expect(options.schema).toBe(publicCategoryManagementItemSchema);
  });

  it('patches exactly one localized label on the existing category', async () => {
    await updateManagedCategoryLabel('cat/1', { name: 'Science Fiction', locale: 'en-US' });
    const [path, options] = callArgs();
    expect(path).toBe('/api/admin/discovery/categories/cat%2F1/labels');
    expect(options.method).toBe('PATCH');
    expect(options.json).toEqual({ name: 'Science Fiction', locale: 'en-US' });
  });

  it('lists one category’s assigned source records with search and pagination', async () => {
    await listCategorySourceRecords('cat-1', { page: 3, q: 'darwin' });
    const [path, options] = callArgs();
    expect(path.startsWith('/api/admin/discovery/categories/cat-1/source-records?')).toBe(true);
    expect(queryOf(path).get('page')).toBe('3');
    expect(queryOf(path).get('q')).toBe('darwin');
    expect(options.schema).toBeDefined();
  });

  it('searches assignable source records through the admin source-records endpoint', async () => {
    await searchAssignableSourceRecords('darwin');
    const [path, options] = callArgs();
    expect(path.startsWith('/api/admin/discovery/source-records?')).toBe(true);
    expect(queryOf(path).get('q')).toBe('darwin');
    expect(options.schema).toBeDefined();
  });

  it('assigns exactly one record/category pair with PUT', async () => {
    await assignCategoryToSourceRecord('source/1', 'cat-1');
    const [path, options] = callArgs();
    expect(path).toBe('/api/admin/discovery/source-records/source%2F1/categories/cat-1');
    expect(options.method).toBe('PUT');
    expect(options.schema).toBeDefined();
  });

  it('removes exactly one record/category pair with DELETE', async () => {
    await unassignCategoryFromSourceRecord('source-1', 'cat/2');
    const [path, options] = callArgs();
    expect(path).toBe('/api/admin/discovery/source-records/source-1/categories/cat%2F2');
    expect(options.method).toBe('DELETE');
    expect(options.schema).toBeDefined();
  });

  it('exposes stable query keys for list, records, and candidates', () => {
    expect(publicCategoriesQueryKey.list()).toEqual(['admin', 'public-categories', 'list']);
    expect(publicCategoriesQueryKey.records('cat-1', { page: 1 })).toEqual([
      'admin',
      'public-categories',
      'records',
      'cat-1',
      { page: 1 },
    ]);
    expect(publicCategoriesQueryKey.candidates('sci')).toEqual(['admin', 'public-categories', 'candidates', 'sci']);
  });
});

describe('category error classification', () => {
  it('detects the localized-label uniqueness collision code', () => {
    const error = new ApiRequestError({
      message: 'exists',
      status: 409,
      code: PUBLIC_CATEGORY_NAME_EXISTS_CODE,
    });
    expect(isCategoryNameCollisionError(error)).toBe(true);
    expect(isCategoryNameCollisionError(new Error('other'))).toBe(false);
  });

  it('detects the assignment-limit collision code', () => {
    const error = new ApiRequestError({
      message: 'limit',
      status: 409,
      code: PUBLIC_CATEGORY_LIMIT_EXCEEDED_CODE,
    });
    expect(isCategoryAssignmentLimitError(error)).toBe(true);
    expect(isCategoryNameCollisionError(error)).toBe(false);
  });
});

describe('provider independence and deferred AI translation', () => {
  const featureDirectory = dirname(fileURLToPath(import.meta.url));
  const source = readdirSync(featureDirectory)
    .filter((file) => (file.endsWith('.ts') || file.endsWith('.tsx')) && !file.endsWith('.spec.ts'))
    .map((file) => readFileSync(resolve(featureDirectory, file), 'utf8'))
    .join('\n');

  it('never imports or calls an AI provider or the deferred PC-03 translation action', () => {
    expect(source).not.toMatch(
      /invokeAi|provider-scope|providerScope|@gloaming\/shared\/llm|ai-config|translateMissingPublicCategoryLabels/,
    );
  });
});
