import { describe, expect, it } from 'vitest';

import type { TaxonomyItem } from '@gloaming/shared/taxonomy';

import {
  buildTaxonomyNamesPayload,
  filterTaxonomyItems,
  formatTaxonomyLocaleCell,
  formatTranslationStatusLabel,
  getTranslationStatus,
  matchesTaxonomySearch,
  resolveTaxonomyAuxiliaryName,
  resolveTaxonomyItemById,
  resolveTaxonomyPrimaryName,
} from './taxonomy-format';

function sampleItem(overrides: Partial<TaxonomyItem> = {}): TaxonomyItem {
  return {
    id: 'tag-1',
    names: { 'zh-CN': '科学', 'en-US': 'Science' },
    origin: 'manual',
    usage: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('taxonomy-format', () => {
  it('detects complete vs partial translation status', () => {
    expect(getTranslationStatus({ 'zh-CN': '科学', 'en-US': 'Science' })).toBe('complete');
    expect(getTranslationStatus({ 'zh-CN': '科学' })).toBe('partial');
    expect(getTranslationStatus({ 'en-US': 'Science' })).toBe('partial');
  });

  it('shows explicit missing labels without cross-locale fallback', () => {
    expect(formatTaxonomyLocaleCell({ 'en-US': 'Science' }, 'zh-CN', 'zh-CN')).toBe('缺失中文');
    expect(formatTaxonomyLocaleCell({ 'zh-CN': '科学' }, 'en-US', 'zh-CN')).toBe('缺失英文');
    expect(formatTaxonomyLocaleCell({ 'zh-CN': '科学', 'en-US': 'Science' }, 'zh-CN', 'zh-CN')).toBe('科学');
    expect(formatTaxonomyLocaleCell({ 'zh-CN': '科学', 'en-US': 'Science' }, 'en-US', 'zh-CN')).toBe('Science');
    expect(formatTaxonomyLocaleCell({ 'en-US': 'Science' }, 'zh-CN', 'en-US')).toBe('Missing Chinese');
    expect(formatTaxonomyLocaleCell({ 'zh-CN': '科学' }, 'en-US', 'en-US')).toBe('Missing English');
  });

  it('formats translation status labels', () => {
    expect(formatTranslationStatusLabel('complete', 'zh-CN')).toBe('完整');
    expect(formatTranslationStatusLabel('partial', 'zh-CN')).toBe('部分');
    expect(formatTranslationStatusLabel('complete', 'en-US')).toBe('Complete');
    expect(formatTranslationStatusLabel('partial', 'en-US')).toBe('Partial');
  });

  it('searches both Chinese and English names', () => {
    const items = [
      sampleItem({ id: 'a', names: { 'zh-CN': '奇幻', 'en-US': 'Fantasy' } }),
      sampleItem({ id: 'b', names: { 'zh-CN': '科学', 'en-US': 'Science' } }),
      sampleItem({ id: 'c', names: { 'en-US': 'Mystery' } }),
    ];

    expect(matchesTaxonomySearch(items[0], '奇幻')).toBe(true);
    expect(matchesTaxonomySearch(items[0], 'fantasy')).toBe(true);
    expect(matchesTaxonomySearch(items[2], '科学')).toBe(false);
    expect(matchesTaxonomySearch(items[2], 'mystery')).toBe(true);
  });

  it('filters by translation completeness and preserves filtered order for row indexes', () => {
    const items = [
      sampleItem({ id: 'complete-1', names: { 'zh-CN': '甲', 'en-US': 'A' } }),
      sampleItem({ id: 'partial-1', names: { 'zh-CN': '乙' } }),
      sampleItem({ id: 'complete-2', names: { 'zh-CN': '丙', 'en-US': 'C' } }),
    ];

    const partialOnly = filterTaxonomyItems(items, { translationFilter: 'partial' });
    expect(partialOnly.map((item) => item.id)).toEqual(['partial-1']);

    const completeOnly = filterTaxonomyItems(items, { translationFilter: 'complete' });
    expect(completeOnly.map((item) => item.id)).toEqual(['complete-1', 'complete-2']);

    const bilingualSearch = filterTaxonomyItems(items, { search: 'c' });
    expect(bilingualSearch.map((item) => item.id)).toEqual(['complete-2']);
  });

  it('builds create/update names payloads from bilingual form fields', () => {
    expect(buildTaxonomyNamesPayload('科学', 'Science')).toEqual({ 'zh-CN': '科学', 'en-US': 'Science' });
    expect(buildTaxonomyNamesPayload('科学', '')).toEqual({ 'zh-CN': '科学' });
    expect(buildTaxonomyNamesPayload('', 'Science')).toEqual({ 'en-US': 'Science' });
    expect(buildTaxonomyNamesPayload('  ', '')).toBeNull();
  });

  it('resolves picker primary and auxiliary names by locale without duplicating fallback', () => {
    const names = { 'zh-CN': '科学', 'en-US': 'Science' };
    expect(resolveTaxonomyPrimaryName(names, 'zh-CN')).toBe('科学');
    expect(resolveTaxonomyAuxiliaryName(names, 'zh-CN')).toBe('Science');
    expect(resolveTaxonomyPrimaryName(names, 'en-US')).toBe('Science');
    expect(resolveTaxonomyAuxiliaryName(names, 'en-US')).toBe('科学');
    expect(resolveTaxonomyAuxiliaryName({ 'en-US': 'Science' }, 'zh-CN')).toBeNull();
  });

  it('resolves taxonomy items by stable id for picker selection', () => {
    const items = [sampleItem({ id: 'tag-a' }), sampleItem({ id: 'tag-b', names: { 'en-US': 'Beta' } })];
    const selected = resolveTaxonomyItemById(items, 'tag-b');
    const selectedNames = selected && 'names' in selected ? selected.names : undefined;
    expect(selectedNames?.['en-US']).toBe('Beta');
    expect(resolveTaxonomyItemById(items, 'missing')).toBeUndefined();
  });
});
