import { describe, expect, it } from 'vitest';

import {
  buildLocalizedNamesMap,
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

  it('builds localized_names with ref.name fallback for missing locales', () => {
    expect(buildLocalizedNamesMap([{ locale: 'en-US', name: 'Science' }], 'Science')).toEqual({
      'en-US': 'Science',
      'zh-CN': 'Science',
    });
  });

  it('detects incomplete taxonomy localization', () => {
    expect(isTaxonomyLocalizationComplete({ 'en-US': 'Science' })).toBe(false);
    expect(isTaxonomyLocalizationComplete({ 'en-US': 'Science', 'zh-CN': '科学' })).toBe(true);
    expect(isTaxonomyLocalizationComplete({})).toBe(false);
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
});
