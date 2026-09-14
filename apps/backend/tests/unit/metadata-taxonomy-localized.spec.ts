import { describe, expect, it } from 'vitest';

import {
  buildLocalizedNamesMap,
  inferLocaleForLabel,
  isTaxonomyLocalizationComplete,
  mergeTaxonomyLocalizedNames,
  parseLocalizedNameEntries,
  supportedLocalesLabel,
} from '@/modules/metadata-enrich/taxonomy-localized';

describe('metadata-enrich taxonomy localization helpers', () => {
  it('lists supported locales from @gloaming/i18n', () => {
    expect(supportedLocalesLabel()).toBe('zh-CN, en-US');
  });

  it('parses localized name entries and rejects unsupported locales', () => {
    expect(
      parseLocalizedNameEntries([
        { locale: 'zh-CN', name: '科学' },
        { locale: 'en-US', name: 'Science' },
        { locale: 'fr-FR', name: 'Science' },
      ]),
    ).toEqual([
      { locale: 'zh-CN', name: '科学' },
      { locale: 'en-US', name: 'Science' },
    ]);
  });

  it('stores only zh-CN when only Chinese is provided', () => {
    expect(buildLocalizedNamesMap([{ locale: 'zh-CN', name: '科学' }], '科学')).toEqual({
      'zh-CN': '科学',
    });
  });

  it('stores only en-US when only English is provided', () => {
    expect(buildLocalizedNamesMap([{ locale: 'en-US', name: 'Science' }], 'Science')).toEqual({
      'en-US': 'Science',
    });
  });

  it('stores both locales when bilingual entries are provided', () => {
    expect(
      buildLocalizedNamesMap(
        [
          { locale: 'zh-CN', name: '科学' },
          { locale: 'en-US', name: 'Science' },
        ],
        'Science',
      ),
    ).toEqual({
      'zh-CN': '科学',
      'en-US': 'Science',
    });
  });

  it('does not copy fallbackName into missing locales', () => {
    expect(buildLocalizedNamesMap([{ locale: 'en-US', name: 'Science' }], 'Science')).toEqual({
      'en-US': 'Science',
    });
    expect(buildLocalizedNamesMap([], 'Science')).toEqual({
      'en-US': 'Science',
    });
    expect(buildLocalizedNamesMap([], '寓言')).toEqual({
      'zh-CN': '寓言',
    });
  });

  it('detects incomplete taxonomy localization from actual locale values only', () => {
    expect(isTaxonomyLocalizationComplete({ 'en-US': 'Science' })).toBe(false);
    expect(isTaxonomyLocalizationComplete({ 'zh-CN': '科学' })).toBe(false);
    expect(isTaxonomyLocalizationComplete({ 'en-US': 'Science', 'zh-CN': '科学' })).toBe(true);
    expect(isTaxonomyLocalizationComplete({})).toBe(false);
    expect(isTaxonomyLocalizationComplete(undefined)).toBe(false);
  });

  it('merges localized names without dropping existing locales', () => {
    expect(
      mergeTaxonomyLocalizedNames({ 'zh-CN': '科学', 'en-US': 'Old' }, { 'en-US': 'Science', 'zh-CN': '自然科学' }),
    ).toEqual({
      'zh-CN': '自然科学',
      'en-US': 'Science',
    });
    expect(mergeTaxonomyLocalizedNames({ 'zh-CN': '科学' }, { 'en-US': 'Science' })).toEqual({
      'zh-CN': '科学',
      'en-US': 'Science',
    });
  });

  it('handles empty maps safely during merge', () => {
    expect(mergeTaxonomyLocalizedNames(undefined, {})).toEqual({});
    expect(mergeTaxonomyLocalizedNames({}, { 'en-US': 'Science' })).toEqual({ 'en-US': 'Science' });
    expect(mergeTaxonomyLocalizedNames(null, { 'zh-CN': '科学' })).toEqual({ 'zh-CN': '科学' });
  });

  it('infers locale from label script and book language', () => {
    expect(inferLocaleForLabel('科学')).toBe('zh-CN');
    expect(inferLocaleForLabel('Science')).toBe('en-US');
    expect(inferLocaleForLabel('Fables', 'zh-CN')).toBe('zh-CN');
    expect(inferLocaleForLabel('Fables', 'en')).toBe('en-US');
  });
});
