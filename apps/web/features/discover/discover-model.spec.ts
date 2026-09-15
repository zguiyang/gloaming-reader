import { describe, expect, it } from 'vitest';

import { catalogListDataSchema } from '@gloaming/shared/works';

import { taxonomyCoverTintSeeds, taxonomyDisplayName } from '@/features/discover/discover-model';

const bilingualTag = {
  id: 'tag-science',
  names: { 'zh-CN': '科学', 'en-US': 'Science' },
  origin: 'manual' as const,
};

const zhOnlyTag = {
  id: 'tag-zh-only',
  names: { 'zh-CN': '经典' },
  origin: 'manual' as const,
};

describe('discover taxonomy display', () => {
  it('shows the requested locale label when present', () => {
    expect(taxonomyDisplayName(bilingualTag, 'zh-CN')).toBe('科学');
    expect(taxonomyDisplayName(bilingualTag, 'en-US')).toBe('Science');
  });

  it('falls back to another locale without treating fallback as full translation', () => {
    expect(taxonomyDisplayName(zhOnlyTag, 'en-US')).toBe('经典');
  });

  it('builds stable WorkCover tint seeds from taxonomy ids', () => {
    expect(taxonomyCoverTintSeeds([bilingualTag, zhOnlyTag])).toEqual(['tag-science', 'tag-zh-only']);
  });
});

describe('discover catalog contract', () => {
  const pagination = {
    page: 1,
    pageSize: 15,
    total: 0,
    totalPages: 0,
    sortBy: 'publishedAt' as const,
    sortOrder: 'desc' as const,
  };

  it('accepts catalog list payloads with items and pagination only', () => {
    const payload = catalogListDataSchema.parse({
      items: [],
      pagination,
    });
    expect(payload.items).toEqual([]);
    expect(payload.pagination.page).toBe(1);
  });

  it('does not surface tag facets bundled in catalog list payloads', () => {
    const payload = catalogListDataSchema.parse({
      items: [],
      pagination,
      tags: [bilingualTag],
    });
    expect(payload).not.toHaveProperty('tags');
  });
});
