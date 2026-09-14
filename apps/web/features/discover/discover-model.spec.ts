import { describe, expect, it } from 'vitest';

import { catalogListDataSchema } from '@gloaming/shared/works';

import { catalogTagQueryValue, taxonomyCoverTintSeeds, taxonomyDisplayName } from '@/features/discover/discover-model';

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

  it('derives catalog tag query values from canonical English labels when present', () => {
    expect(catalogTagQueryValue(bilingualTag)).toBe('Science');
    expect(catalogTagQueryValue(zhOnlyTag)).toBe('经典');
  });
});

describe('discover catalog contract', () => {
  it('rejects legacy string tag facets from catalog list payloads', () => {
    expect(() =>
      catalogListDataSchema.parse({
        items: [],
        pagination: { page: 1, pageSize: 15, total: 0, totalPages: 0, sortBy: 'publishedAt', sortOrder: 'desc' },
        tags: ['Classic'],
      }),
    ).toThrow();
  });

  it('accepts taxonomy reference tag facets', () => {
    const payload = catalogListDataSchema.parse({
      items: [],
      pagination: { page: 1, pageSize: 15, total: 0, totalPages: 0, sortBy: 'publishedAt', sortOrder: 'desc' },
      tags: [bilingualTag],
    });
    expect(payload.tags[0]?.id).toBe('tag-science');
  });
});
