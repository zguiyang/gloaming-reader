import { describe, expect, it } from 'vitest';

import {
  buildPaginationMeta,
  createSortByQuerySchema,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT_ORDER,
  paginationQuerySchema,
} from './pagination.ts';

describe('paginationQuerySchema', () => {
  it('fills defaults when params are missing', () => {
    expect(paginationQuerySchema.parse({})).toEqual({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
      sortOrder: DEFAULT_SORT_ORDER,
    });
  });

  it('coerces string query values and treats blanks as default', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '25', sortOrder: 'asc' })).toEqual({
      page: 3,
      pageSize: 25,
      sortOrder: 'asc',
    });
    expect(paginationQuerySchema.parse({ page: '', pageSize: '  ', sortOrder: '' })).toEqual({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
      sortOrder: DEFAULT_SORT_ORDER,
    });
  });

  it('rejects non-positive page or pageSize', () => {
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ pageSize: '-1' }).success).toBe(false);
  });
});

describe('createSortByQuerySchema', () => {
  const sortBy = createSortByQuerySchema(['publishedAt', 'updatedAt', 'createdAt'] as const, 'publishedAt');

  it('defaults and accepts allowed values', () => {
    expect(sortBy.parse(undefined)).toBe('publishedAt');
    expect(sortBy.parse('')).toBe('publishedAt');
    expect(sortBy.parse('updatedAt')).toBe('updatedAt');
  });

  it('rejects unknown fields', () => {
    expect(sortBy.safeParse('title').success).toBe(false);
  });
});

describe('buildPaginationMeta', () => {
  it('computes totalPages', () => {
    expect(
      buildPaginationMeta({
        page: 1,
        pageSize: 10,
        total: 42,
        sortBy: 'publishedAt',
        sortOrder: 'desc',
      }),
    ).toMatchObject({ totalPages: 5, total: 42 });
  });
});
