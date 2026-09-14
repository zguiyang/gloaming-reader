import { describe, expect, it } from 'vitest';

import { areProductTagsWeak, cleanSubjectsToProductTags, isCatalogLikeTag } from '@/modules/metadata-fill/subjects';

describe('metadata-fill subject → product tags', () => {
  it('detects LCSH / catalog-like strings', () => {
    expect(isCatalogLikeTag('Fables, Greek -- Translations into English')).toBe(true);
    expect(isCatalogLikeTag('Earth (Planet) -- Core -- Fiction')).toBe(true);
    expect(isCatalogLikeTag('x'.repeat(41))).toBe(true);
    expect(isCatalogLikeTag('Translations into English')).toBe(true);
    expect(isCatalogLikeTag('Science Fiction')).toBe(false);
    expect(isCatalogLikeTag('Fables')).toBe(false);
  });

  it('salvages short head segments from LCSH and drops subdivisions', () => {
    expect(cleanSubjectsToProductTags(['Fables, Greek -- Translations into English'])).toEqual(['Fables', 'Greek']);
    expect(cleanSubjectsToProductTags(['Science Fiction', 'Adventure'])).toEqual(['Science Fiction', 'Adventure']);
    expect(cleanSubjectsToProductTags(['Translations into English'])).toEqual([]);
    expect(cleanSubjectsToProductTags(['Fiction', 'Novel'])).toEqual([]);
  });

  it('keeps ambiguous entities as bounded candidates for AI review', () => {
    expect(cleanSubjectsToProductTags(['Indiana', 'Teachers'])).toEqual(['Indiana', 'Teachers']);
    expect(cleanSubjectsToProductTags(Array.from({ length: 20 }, (_, index) => `Topic ${index + 1}`))).toHaveLength(12);
  });

  it('treats empty or catalog-like product tags as weak', () => {
    expect(areProductTagsWeak([])).toBe(true);
    expect(areProductTagsWeak(['Fables, Greek -- Translations into English'])).toBe(true);
    expect(areProductTagsWeak(['Fables', 'Greek'])).toBe(false);
    expect(areProductTagsWeak(['Science'])).toBe(false);
  });
});
