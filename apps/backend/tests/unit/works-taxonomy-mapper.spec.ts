import { describe, expect, it } from 'vitest';

import {
  aggregateTaxonomyReferences,
  buildTaxonomyNames,
  toCatalogTaxonomyFacet,
  toSourceReference,
  toTaxonomyReference,
} from '@/modules/works/taxonomy-mapper';

describe('works taxonomy mapper', () => {
  it('builds full names from localized_names without dropping locales', () => {
    expect(buildTaxonomyNames({ 'zh-CN': '科学', 'en-US': 'Science' }, 'Science')).toEqual({
      'zh-CN': '科学',
      'en-US': 'Science',
    });
  });

  it('falls back to legacy name when localized_names is empty', () => {
    expect(buildTaxonomyNames({}, 'Fables')).toEqual({ 'en-US': 'Fables' });
  });

  it('maps tag/category rows to taxonomy references without matchRule', () => {
    expect(
      toTaxonomyReference({
        id: 'tag-1',
        name: 'Science',
        localizedNames: { 'en-US': 'Science', 'zh-CN': '科学' },
        origin: 'manual',
      }),
    ).toEqual({
      id: 'tag-1',
      names: { 'en-US': 'Science', 'zh-CN': '科学' },
      origin: 'manual',
    });
  });

  it('includes matchRule on source references', () => {
    expect(
      toSourceReference({
        id: 'source-1',
        name: 'Gutenberg',
        origin: 'extracted',
        matchRule: 'gutenberg.org',
      }),
    ).toEqual({
      id: 'source-1',
      name: 'Gutenberg',
      origin: 'extracted',
      matchRule: 'gutenberg.org',
    });
  });

  it('maps catalog facets without provenance fields', () => {
    expect(
      toCatalogTaxonomyFacet({
        id: 'tag-1',
        name: 'Science',
        localizedNames: { 'en-US': 'Science', 'zh-CN': '科学' },
        origin: 'manual',
      }),
    ).toEqual({
      id: 'tag-1',
      names: { 'en-US': 'Science', 'zh-CN': '科学' },
    });
  });

  it('dedupes catalog facet tags by stable id', () => {
    const ref = {
      id: 'tag-1',
      names: { 'en-US': 'Science', 'zh-CN': '科学' },
      origin: 'manual' as const,
    };
    expect(aggregateTaxonomyReferences([ref, ref])).toEqual([ref]);
  });
});
