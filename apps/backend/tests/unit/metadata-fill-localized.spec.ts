import { describe, expect, it } from 'vitest';

import type { LocalizedTextMap } from '@gloaming/shared/taxonomy';

import { inferLocaleForLabel, mergeTaxonomyLocalizedNames } from '@/modules/metadata-enrich/taxonomy-localized';

/** Mirrors metadata-fill tag write contract without DB access. */
function buildExtractedTagLocalizedNames(name: string, bookLanguage?: string): LocalizedTextMap {
  const locale = inferLocaleForLabel(name, bookLanguage);
  return { [locale]: name };
}

describe('metadata-fill extracted tag localized names', () => {
  it('writes English-only extracted tags to en-US', () => {
    expect(buildExtractedTagLocalizedNames('Fables', 'en')).toEqual({ 'en-US': 'Fables' });
  });

  it('writes Chinese extracted tags to zh-CN', () => {
    expect(buildExtractedTagLocalizedNames('寓言', 'zh-CN')).toEqual({ 'zh-CN': '寓言' });
  });

  it('merges with existing localizedNames without overwriting untouched locales', () => {
    const incoming = buildExtractedTagLocalizedNames('Science', 'en');
    expect(mergeTaxonomyLocalizedNames({ 'zh-CN': '科学' }, incoming)).toEqual({
      'zh-CN': '科学',
      'en-US': 'Science',
    });
  });

  it('keeps empty existing maps safe when first extracted tag is written', () => {
    const incoming = buildExtractedTagLocalizedNames('Adventure', 'en');
    expect(mergeTaxonomyLocalizedNames({}, incoming)).toEqual({ 'en-US': 'Adventure' });
    expect(mergeTaxonomyLocalizedNames(undefined, incoming)).toEqual({ 'en-US': 'Adventure' });
  });
});
