import { describe, expect, it } from 'vitest';

import {
  isPublicCategoryTranslationMissing,
  normalizePublicCategoryName,
  publicCategoryLabelSchema,
  publicCategorySchema,
  resolvePublicCategoryName,
  sourceRecordItemSchema,
  sourceRecordListQuerySchema,
  sourceRecordPublicCategorySchema,
} from './discovery.ts';

describe('public category contracts', () => {
  it('normalizes labels with Unicode NFC, whitespace folding, and locale-independent case folding', () => {
    expect(normalizePublicCategoryName('  Science   Fiction  ')).toBe('science fiction');
    expect(normalizePublicCategoryName('E\u0301tudes')).toBe(normalizePublicCategoryName('\u00c9tudes'));
    expect(normalizePublicCategoryName('Computer\nScience')).toBe('computer science');
    // Punctuation is meaningful and is preserved rather than stripped.
    expect(normalizePublicCategoryName('C++')).toBe('c++');
  });

  it('keeps a stable identity with localized labels and manual-protected locales', () => {
    const category = publicCategorySchema.parse({
      id: 'cat-scifi',
      createdBy: 'ai',
      sourceLocale: 'en-US',
      manualLocales: ['zh-CN'],
      localizedNames: { 'en-US': 'Science Fiction', 'zh-CN': '科幻小说' },
    });
    expect(category.createdBy).toBe('ai');
    expect(resolvePublicCategoryName(category, 'zh-CN')).toBe('科幻小说');
    expect(isPublicCategoryTranslationMissing(category, 'zh-CN')).toBe(false);
    expect(isPublicCategoryTranslationMissing(category, 'fr-FR')).toBe(true);
  });

  it('falls back to the source locale then any label without claiming a translation', () => {
    const category = publicCategorySchema.parse({
      id: 'cat-history',
      createdBy: 'manual',
      sourceLocale: 'en-US',
      localizedNames: { 'en-US': 'History' },
    });
    expect(resolvePublicCategoryName(category, 'zh-CN')).toBe('History');
    expect(isPublicCategoryTranslationMissing(category, 'zh-CN')).toBe(true);

    const canonicalOnly = publicCategorySchema.parse({
      id: 'cat-poetry',
      createdBy: 'manual',
      localizedNames: { 'zh-CN': '诗歌' },
    });
    expect(resolvePublicCategoryName(canonicalOnly, 'en-US')).toBe('诗歌');

    const empty = publicCategorySchema.parse({ id: 'cat-empty', createdBy: 'manual' });
    expect(empty).toMatchObject({ sourceLocale: null, manualLocales: [], localizedNames: {} });
    expect(resolvePublicCategoryName(empty, 'en-US')).toBeNull();
  });

  it('carries label edit and assignment provenance plus a category filter on the SourceRecord query', () => {
    expect(publicCategoryLabelSchema.parse({ locale: 'en-US', name: 'History', editedBy: 'manual' })).toEqual({
      locale: 'en-US',
      name: 'History',
      editedBy: 'manual',
    });
    expect(sourceRecordPublicCategorySchema.parse({ categoryId: 'cat-1', source: 'ai' })).toEqual({
      categoryId: 'cat-1',
      source: 'ai',
    });
    expect(() => sourceRecordPublicCategorySchema.parse({ categoryId: 'cat-1', source: 'user' })).toThrow();

    expect(sourceRecordListQuerySchema.parse({}).categoryId).toBeUndefined();
    expect(sourceRecordListQuerySchema.parse({ categoryId: 'cat-1' }).categoryId).toBe('cat-1');
    expect(sourceRecordListQuerySchema.parse({ categoryId: '' }).categoryId).toBeUndefined();
  });

  it('keeps SourceRecord categories optional until the read model projects them', () => {
    const base = {
      sourceRecordId: 'sr-1',
      sourceId: 'src-1',
      sourceKey: 'gutenberg',
      sourceType: 'rdf',
      externalId: '1342',
      title: 'Pride and Prejudice',
      authors: [],
      languages: ['en'],
      description: null,
      coverUrl: null,
      availability: 'available' as const,
      sourceUpdatedAt: null,
      lastSeenAt: null,
      createdAt: '2026-10-11T00:00:00.000Z',
      updatedAt: '2026-10-11T00:00:00.000Z',
    };
    expect(sourceRecordItemSchema.parse(base).categories).toBeUndefined();
    expect(
      sourceRecordItemSchema.parse({
        ...base,
        categories: [{ id: 'cat-1', createdBy: 'manual', localizedNames: { 'en-US': 'Romance' } }],
      }).categories?.[0]?.id,
    ).toBe('cat-1');
  });
});
