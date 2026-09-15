import { describe, expect, it } from 'vitest';

import {
  catalogTaxonomyFacetSchema,
  catalogTaxonomyListDataSchema,
  localizedTextSchema,
  mergeLocalizedText,
  optionalLocalizedText,
  resolveLocalizedText,
  sourceReferenceSchema,
  taxonomyItemSchema,
  taxonomyListDataSchema,
  taxonomyReferenceSchema,
  taxonomySelectionSchema,
} from './taxonomy.ts';

const sampleNames = { 'zh-CN': '科学', 'en-US': 'Science' };

describe('taxonomy i18n contracts', () => {
  it('accepts localized text with at least one supported locale', () => {
    expect(localizedTextSchema.parse({ 'zh-CN': '科学' })).toEqual({ 'zh-CN': '科学' });
    expect(localizedTextSchema.parse(sampleNames)).toEqual(sampleNames);
  });

  it('rejects localized text without any supported locale', () => {
    expect(localizedTextSchema.safeParse({}).success).toBe(false);
    expect(localizedTextSchema.safeParse({ 'zh-CN': '   ' }).success).toBe(false);
  });

  it('accepts taxonomy references with id, names, and origin', () => {
    const ref = taxonomyReferenceSchema.parse({
      id: 'tag-1',
      names: sampleNames,
      origin: 'manual',
    });
    expect(ref.id).toBe('tag-1');
    expect(ref.names).toEqual(sampleNames);
  });

  it('accepts source references with a raw name and rejects localized names', () => {
    expect(sourceReferenceSchema.parse({ id: 'source-1', name: 'Project Gutenberg', origin: 'extracted' })).toEqual({
      id: 'source-1',
      name: 'Project Gutenberg',
      origin: 'extracted',
    });
    expect(
      sourceReferenceSchema.safeParse({
        id: 'source-1',
        names: sampleNames,
        origin: 'extracted',
      }).success,
    ).toBe(false);
  });

  it('accepts taxonomy selections with id only', () => {
    expect(taxonomySelectionSchema.parse({ id: 'tag-1' })).toEqual({ id: 'tag-1' });
  });

  it('rejects taxonomy selections that include display fields', () => {
    expect(
      taxonomySelectionSchema.safeParse({
        id: 'tag-1',
        names: sampleNames,
        origin: 'manual',
      }).success,
    ).toBe(false);
  });
});

describe('catalog taxonomy facet contracts', () => {
  it('accepts public catalog facets with localized names only', () => {
    const payload = catalogTaxonomyListDataSchema.parse({
      items: [{ id: 'tag-1', names: sampleNames }],
    });
    expect(payload.items[0]?.names).toEqual(sampleNames);
  });

  it('rejects admin-only taxonomy fields on catalog facets', () => {
    expect(
      catalogTaxonomyFacetSchema.safeParse({
        id: 'tag-1',
        names: sampleNames,
        origin: 'manual',
      }).success,
    ).toBe(false);
  });
});

describe('taxonomy api contracts', () => {
  it('accepts taxonomy items with localized names', () => {
    const item = taxonomyItemSchema.parse({
      id: 't1',
      names: sampleNames,
      usage: 2,
      origin: 'manual',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(item.names).toEqual(sampleNames);
  });

  it('rejects legacy single-string taxonomy return fields', () => {
    expect(
      taxonomyItemSchema.safeParse({
        id: 't1',
        name: 'Science',
        usage: 2,
        origin: 'manual',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('accepts taxonomy list payloads with localized items', () => {
    const payload = taxonomyListDataSchema.parse({
      items: [
        {
          id: 's1',
          name: 'New York Times',
          usage: 0,
          origin: 'manual',
          matchRule: 'nytimes.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.name).toBe('New York Times');
  });
});

describe('taxonomy locale projection', () => {
  it('prefers the requested locale', () => {
    expect(resolveLocalizedText(sampleNames, 'zh-CN')).toBe('科学');
    expect(resolveLocalizedText(sampleNames, 'en-US')).toBe('Science');
  });

  it('falls back to the other supported locale when missing or blank', () => {
    expect(resolveLocalizedText({ 'zh-CN': '科学' }, 'en-US')).toBe('科学');
    expect(resolveLocalizedText({ 'en-US': '   ' }, 'en-US')).toBe('');
    expect(resolveLocalizedText(undefined, 'zh-CN')).toBe('');
  });

  it('merges locale-specific names without dropping other locales', () => {
    expect(mergeLocalizedText({ 'zh-CN': '科学' }, 'en-US', 'Science')).toEqual({
      'zh-CN': '科学',
      'en-US': 'Science',
    });
    expect(mergeLocalizedText({ 'zh-CN': '科学' }, 'zh-CN', '自然科学')).toEqual({
      'zh-CN': '自然科学',
    });
  });

  it('omits empty localized text maps from API payloads', () => {
    expect(optionalLocalizedText({})).toBeUndefined();
    expect(optionalLocalizedText(undefined)).toBeUndefined();
    expect(optionalLocalizedText({ 'zh-CN': '科学' })).toEqual({ 'zh-CN': '科学' });
  });
});
