import { describe, expect, it } from 'vitest';

import type { TaxonomyReference } from '@gloaming/shared/taxonomy';

import {
  categoryReferenceId,
  categoryReviewItems,
  formatWorkTaxonomyLabel,
  taxonomyReferenceIds,
  toTaxonomySelection,
  toTaxonomySelections,
} from './works-taxonomy';

function ref(
  id: string,
  names: TaxonomyReference['names'],
  origin: TaxonomyReference['origin'] = 'manual',
): TaxonomyReference {
  return { id, names, origin };
}

describe('works-taxonomy', () => {
  const bilingual = ref('tag-science', { 'zh-CN': '科学', 'en-US': 'Science' });
  const englishOnly = ref('tag-fantasy', { 'en-US': 'Fantasy' }, 'ai');

  it('extracts stable taxonomy ids for picker state', () => {
    expect(taxonomyReferenceIds([bilingual, englishOnly])).toEqual(['tag-science', 'tag-fantasy']);
  });

  it('builds id-only update payloads', () => {
    expect(toTaxonomySelections(['tag-science', 'tag-fantasy'])).toEqual([
      { id: 'tag-science' },
      { id: 'tag-fantasy' },
    ]);
    expect(toTaxonomySelection('cat-fiction')).toEqual({ id: 'cat-fiction' });
    expect(toTaxonomySelection(null)).toBeNull();
  });

  it('resolves locale-aware primary labels with safe fallback', () => {
    expect(formatWorkTaxonomyLabel(bilingual, 'zh-CN')).toBe('科学');
    expect(formatWorkTaxonomyLabel(bilingual, 'en-US')).toBe('Science');
    expect(formatWorkTaxonomyLabel(englishOnly, 'zh-CN')).toBe('Fantasy');
  });

  it('falls back to id when names are empty', () => {
    expect(formatWorkTaxonomyLabel(ref('tag-empty', {}), 'zh-CN')).toBe('tag-empty');
  });

  it('maps category references for review and picker state', () => {
    const category = ref('cat-fiction', { 'zh-CN': '小说', 'en-US': 'Fiction' });
    expect(categoryReferenceId(category)).toBe('cat-fiction');
    expect(categoryReferenceId(null)).toBeNull();
    expect(categoryReviewItems(category)).toEqual([category]);
    expect(categoryReviewItems(null)).toEqual([]);
  });
});
