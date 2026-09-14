import { describe, expect, it } from 'vitest';

import {
  mergeLocalizedName,
  optionalLocalizedNames,
  resolveTaxonomyDisplayName,
  taxonomyItemSchema,
  taxonomyListDataSchema,
} from './taxonomy.ts';

describe('taxonomy api contracts', () => {
  it('accepts taxonomy items with and without localizedNames', () => {
    const base = {
      id: 't1',
      name: 'Science',
      usage: 2,
      origin: 'manual' as const,
      matchRule: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(taxonomyItemSchema.parse(base)).toEqual(base);

    const localized = taxonomyItemSchema.parse({
      ...base,
      localizedNames: { 'zh-CN': '科学', 'en-US': 'Science' },
    });
    expect(localized.localizedNames).toEqual({ 'zh-CN': '科学', 'en-US': 'Science' });
  });

  it('accepts taxonomy list payloads with localized items', () => {
    const payload = taxonomyListDataSchema.parse({
      items: [
        {
          id: 's1',
          name: 'NYT',
          localizedNames: { 'zh-CN': '纽约时报' },
          usage: 0,
          origin: 'manual',
          matchRule: 'nytimes.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.localizedNames?.['zh-CN']).toBe('纽约时报');
  });
});

describe('taxonomy locale projection', () => {
  it('prefers localized_names for the requested locale', () => {
    expect(resolveTaxonomyDisplayName({ 'zh-CN': '科学', 'en-US': 'Science' }, 'Fallback', 'zh-CN')).toBe('科学');
    expect(resolveTaxonomyDisplayName({ 'zh-CN': '科学', 'en-US': 'Science' }, 'Fallback', 'en-US')).toBe('Science');
  });

  it('falls back to canonical name when locale is missing or blank', () => {
    expect(resolveTaxonomyDisplayName({ 'zh-CN': '科学' }, 'Science', 'en-US')).toBe('Science');
    expect(resolveTaxonomyDisplayName({ 'en-US': '   ' }, 'Science', 'en-US')).toBe('Science');
    expect(resolveTaxonomyDisplayName(undefined, 'Science', 'zh-CN')).toBe('Science');
  });

  it('merges locale-specific names without dropping other locales', () => {
    expect(mergeLocalizedName({ 'zh-CN': '科学' }, 'en-US', 'Science')).toEqual({
      'zh-CN': '科学',
      'en-US': 'Science',
    });
    expect(mergeLocalizedName({ 'zh-CN': '科学' }, 'zh-CN', '自然科学')).toEqual({
      'zh-CN': '自然科学',
    });
  });

  it('omits empty localizedNames maps from API payloads', () => {
    expect(optionalLocalizedNames({})).toBeUndefined();
    expect(optionalLocalizedNames(undefined)).toBeUndefined();
    expect(optionalLocalizedNames({ 'zh-CN': '科学' })).toEqual({ 'zh-CN': '科学' });
  });
});
