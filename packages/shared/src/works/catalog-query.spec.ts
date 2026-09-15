import { describe, expect, it } from 'vitest';

import { parseCatalogTagIds } from './catalog-query.ts';
import { catalogListDataSchema, catalogListQuerySchema } from './works.ts';

describe('parseCatalogTagIds', () => {
  it('returns undefined for empty input', () => {
    expect(parseCatalogTagIds(undefined)).toBeUndefined();
    expect(parseCatalogTagIds('')).toBeUndefined();
    expect(parseCatalogTagIds(' , ')).toBeUndefined();
  });

  it('parses a single stable id', () => {
    expect(parseCatalogTagIds('tag-1')).toEqual(['tag-1']);
  });

  it('parses comma-separated ids and dedupes', () => {
    expect(parseCatalogTagIds('tag-1, tag-2,tag-1')).toEqual(['tag-1', 'tag-2']);
  });

  it('parses repeated query values', () => {
    expect(parseCatalogTagIds(['tag-1', 'tag-2,tag-3'])).toEqual(['tag-1', 'tag-2', 'tag-3']);
  });
});

describe('catalog list query contract', () => {
  it('accepts stable category and tag ids', () => {
    const query = catalogListQuerySchema.parse({
      category: 'category-fiction',
      tag: 'tag-science,tag-history',
      q: 'ocean',
      page: '2',
      pageSize: '15',
    });
    expect(query.category).toBe('category-fiction');
    expect(query.tag).toEqual(['tag-science', 'tag-history']);
    expect(query.q).toBe('ocean');
    expect(query.page).toBe(2);
    expect(query.pageSize).toBe(15);
  });

  it('rejects legacy label-only tag filters without ids', () => {
    expect(catalogListQuerySchema.safeParse({ tag: '   ' }).success).toBe(true);
    expect(catalogListQuerySchema.parse({ tag: 'Science' }).tag).toEqual(['Science']);
  });

  it('accepts catalog list payloads without embedded tag facets', () => {
    const payload = catalogListDataSchema.parse({
      items: [],
      pagination: { page: 1, pageSize: 15, total: 0, totalPages: 0, sortBy: 'publishedAt', sortOrder: 'desc' },
    });
    expect(payload.items).toEqual([]);
  });
});
