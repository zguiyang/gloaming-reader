import { describe, expect, it } from 'vitest';

import {
  canonicalizePublicCategoryName,
  categorySourceRecordListQuerySchema,
  DEFAULT_SOURCE_RECORD_SORT_BY,
  DISCOVERY_DEFAULT_LANGUAGE,
  isPublicCategoryTranslationMissing,
  normalizePublicCategoryName,
  PUBLIC_CATEGORY_ASSIGNMENT_LIMIT,
  PUBLIC_CATEGORY_NAME_MAX_CHARS,
  publicCategoryAliasSchema,
  publicCategoryLabelSchema,
  publicCategoryListDataSchema,
  publicCategoryListItemSchema,
  publicCategoryListQuerySchema,
  publicCategoryManagementItemSchema,
  publicCategoryNameSchema,
  publicCategorySchema,
  publicCategorySummarySchema,
  publicCategoryWriteSchema,
  resolvePublicCategoryName,
  sourceRecordItemSchema,
  sourceRecordListQuerySchema,
  sourceRecordPublicCategorySchema,
} from './discovery.ts';

const sourceRecordBase = {
  sourceRecordId: 'sr-1',
  linkedWorkId: null,
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
  isSaveable: true,
  detailAvailable: false,
};

describe('public category contracts', () => {
  it('normalizes labels with Unicode NFC, whitespace folding, and locale-independent case folding', () => {
    expect(normalizePublicCategoryName('  Science   Fiction  ')).toBe('science fiction');
    expect(normalizePublicCategoryName('E\u0301tudes')).toBe(normalizePublicCategoryName('\u00c9tudes'));
    expect(normalizePublicCategoryName('Computer\nScience')).toBe('computer science');
    // Punctuation is meaningful and is preserved rather than stripped.
    expect(normalizePublicCategoryName('C++')).toBe('c++');
  });

  it('canonicalizes the display name by trimming and collapsing whitespace while preserving case', () => {
    expect(canonicalizePublicCategoryName('  Science   Fiction  ')).toBe('Science Fiction');
    expect(canonicalizePublicCategoryName('Computer\n\tScience')).toBe('Computer Science');
    expect(canonicalizePublicCategoryName('C++')).toBe('C++');
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

  it('stores a concise meaning and localized aliases for candidate retrieval', () => {
    const category = publicCategorySchema.parse({
      id: 'cat-scifi',
      createdBy: 'ai',
      sourceLocale: 'en-US',
      meaning: 'Speculative fiction grounded in science or technology.',
      localizedNames: { 'en-US': 'Science Fiction' },
      aliases: [
        { locale: 'en-US', alias: 'Sci-Fi', editedBy: 'ai' },
        { locale: 'zh-CN', alias: '科幻', editedBy: 'manual' },
      ],
    });
    expect(category.meaning).toBe('Speculative fiction grounded in science or technology.');
    expect(category.aliases).toEqual([
      { locale: 'en-US', alias: 'Sci-Fi', editedBy: 'ai' },
      { locale: 'zh-CN', alias: '科幻', editedBy: 'manual' },
    ]);
    // Aliases are retrieval keys, not display names: the label stays canonical.
    expect(resolvePublicCategoryName(category, 'en-US')).toBe('Science Fiction');

    const defaults = publicCategorySchema.parse({ id: 'cat-new', createdBy: 'manual' });
    expect(defaults.meaning).toBeNull();
    expect(defaults.aliases).toEqual([]);

    expect(publicCategoryAliasSchema.parse({ locale: 'en-US', alias: 'Sci-Fi', editedBy: 'ai' })).toEqual({
      locale: 'en-US',
      alias: 'Sci-Fi',
      editedBy: 'ai',
    });
    expect(() => publicCategoryAliasSchema.parse({ locale: 'en-US', alias: 'x', editedBy: 'user' })).toThrow();
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

  it('keeps Discover and Reader identities explicitly separate on a SourceRecord item', () => {
    const unlinked = sourceRecordItemSchema.parse(sourceRecordBase);
    expect(unlinked.sourceRecordId).toBe('sr-1');
    expect(unlinked.linkedWorkId).toBeNull();

    const linked = sourceRecordItemSchema.parse({ ...sourceRecordBase, linkedWorkId: 'work-42' });
    expect(linked.sourceRecordId).toBe('sr-1');
    expect(linked.linkedWorkId).toBe('work-42');
  });

  it('requires an explicit saveability marker on every SourceRecord item', () => {
    const { isSaveable: _omitted, ...missing } = sourceRecordBase;
    expect(() => sourceRecordItemSchema.parse(missing)).toThrow();
    expect(sourceRecordItemSchema.parse({ ...sourceRecordBase, isSaveable: false }).isSaveable).toBe(false);
  });

  it('keeps detailAvailable a required boolean that degrades payloads predating it to false', () => {
    // Every current server projection carries the field…
    expect(sourceRecordItemSchema.parse(sourceRecordBase).detailAvailable).toBe(false);
    expect(sourceRecordItemSchema.parse({ ...sourceRecordBase, detailAvailable: true }).detailAvailable).toBe(true);
    // …but a payload from before the field existed must parse as "no detail
    // entry" instead of failing validation.
    const { detailAvailable: _omitted, ...legacy } = sourceRecordBase;
    expect(sourceRecordItemSchema.parse(legacy).detailAvailable).toBe(false);
    // Non-boolean values are never accepted as an availability claim.
    expect(() => sourceRecordItemSchema.parse({ ...sourceRecordBase, detailAvailable: 'yes' })).toThrow();
  });

  it('keeps SourceRecord categories optional until the read model projects them', () => {
    expect(sourceRecordItemSchema.parse(sourceRecordBase).categories).toBeUndefined();
    expect(
      sourceRecordItemSchema.parse({
        ...sourceRecordBase,
        categories: [{ id: 'cat-1', name: 'Romance' }],
      }).categories?.[0]?.id,
    ).toBe('cat-1');
  });

  it('exposes only the minimal category summary in public SourceRecord items', () => {
    const item = sourceRecordItemSchema.parse({
      ...sourceRecordBase,
      categories: [
        {
          id: 'cat-scifi',
          name: 'Science Fiction',
          // Internal retrieval/management fields must never survive the public DTO.
          createdBy: 'ai',
          sourceLocale: 'en-US',
          meaning: 'Speculative fiction grounded in science or technology.',
          manualLocales: ['zh-CN'],
          localizedNames: { 'en-US': 'Science Fiction' },
          aliases: [{ locale: 'en-US', alias: 'Sci-Fi', editedBy: 'ai' }],
        },
      ],
    });

    expect(item.categories).toEqual([{ id: 'cat-scifi', name: 'Science Fiction' }]);
    const summary = item.categories?.[0];
    expect(summary).toEqual(publicCategorySummarySchema.parse({ id: 'cat-scifi', name: 'Science Fiction' }));
    for (const internal of ['createdBy', 'sourceLocale', 'meaning', 'manualLocales', 'localizedNames', 'aliases']) {
      expect(summary).not.toHaveProperty(internal);
    }

    // The full category-management / AI candidate DTO still retains its fields.
    const full = publicCategorySchema.parse({
      id: 'cat-scifi',
      createdBy: 'ai',
      sourceLocale: 'en-US',
      meaning: 'Speculative fiction grounded in science or technology.',
      manualLocales: ['zh-CN'],
      localizedNames: { 'en-US': 'Science Fiction', 'zh-CN': '科幻小说' },
      aliases: [{ locale: 'en-US', alias: 'Sci-Fi', editedBy: 'ai' }],
    });
    expect(full.meaning).toBe('Speculative fiction grounded in science or technology.');
    expect(full.manualLocales).toEqual(['zh-CN']);
    expect(full.aliases).toEqual([{ locale: 'en-US', alias: 'Sci-Fi', editedBy: 'ai' }]);
  });

  it('drops the content-language and category filters from the admin category record query', () => {
    const query = categorySourceRecordListQuerySchema.parse({ language: 'fr', categoryId: 'cat-1', q: 'alpha' });
    expect(query).not.toHaveProperty('language');
    expect(query).not.toHaveProperty('categoryId');
    expect(query.q).toBe('alpha');
    expect(query.sortBy).toBe(DEFAULT_SOURCE_RECORD_SORT_BY);
    expect(query.page).toBe(1);
  });

  it('validates the optional category list content language like the record list', () => {
    // Optional: absent or blank falls back to the shared Discover default.
    expect(publicCategoryListQuerySchema.parse({})).toEqual({ language: DISCOVERY_DEFAULT_LANGUAGE });
    expect(publicCategoryListQuerySchema.parse({ language: '' })).toEqual({ language: DISCOVERY_DEFAULT_LANGUAGE });
    expect(publicCategoryListQuerySchema.parse({ language: ' fr ' })).toEqual({ language: 'fr' });

    // Same validation bound as the record list query.
    expect(sourceRecordListQuerySchema.parse({}).language).toBe(DISCOVERY_DEFAULT_LANGUAGE);
    expect(sourceRecordListQuerySchema.parse({ language: 'fr' }).language).toBe('fr');
    const overLong = 'x'.repeat(36);
    expect(() => publicCategoryListQuerySchema.parse({ language: overLong })).toThrow();
    expect(() => sourceRecordListQuerySchema.parse({ language: overLong })).toThrow();
  });

  it('keeps public list/detail items to id, localized name, and a nonnegative count', () => {
    const item = publicCategoryListItemSchema.parse({ id: 'cat-history', name: 'History', recordCount: 4 });
    expect(item).toEqual({ id: 'cat-history', name: 'History', recordCount: 4 });
    expect(publicCategoryListDataSchema.parse({ items: [item] }).items).toHaveLength(1);
    expect(() => publicCategoryListItemSchema.parse({ id: 'cat-history', name: 'History', recordCount: -1 })).toThrow();

    const withInternalFields = publicCategoryListItemSchema.parse({
      id: 'cat-history',
      name: 'History',
      recordCount: 0,
      meaning: 'past events',
      aliases: [{ locale: 'en-US', alias: 'Past', editedBy: 'ai' }],
    });
    expect(withInternalFields).toEqual({ id: 'cat-history', name: 'History', recordCount: 0 });
  });

  it('extends the full category contract only for the admin management projection', () => {
    const managed = publicCategoryManagementItemSchema.parse({
      id: 'cat-scifi',
      createdBy: 'manual',
      sourceLocale: 'en-US',
      manualLocales: ['en-US'],
      localizedNames: { 'en-US': 'Science Fiction' },
      aliases: [{ locale: 'en-US', alias: 'Sci-Fi', editedBy: 'manual' }],
      recordCount: 2,
    });
    expect(managed.recordCount).toBe(2);
    expect(managed.localizedNames).toEqual({ 'en-US': 'Science Fiction' });
    expect(managed.manualLocales).toEqual(['en-US']);
  });

  it('validates category write labels and exposes the product assignment cap', () => {
    expect(publicCategoryWriteSchema.parse({ name: '  Science   Fiction  ' }).name).toBe('Science Fiction');
    expect(publicCategoryWriteSchema.parse({ name: 'Science Fiction', locale: 'en-US' }).locale).toBe('en-US');
    expect(publicCategoryNameSchema.safeParse('').success).toBe(false);
    expect(publicCategoryNameSchema.safeParse('x'.repeat(PUBLIC_CATEGORY_NAME_MAX_CHARS + 1)).success).toBe(false);
    // Bidi/control characters are rejected so a label cannot spoof surrounding UI.
    expect(publicCategoryNameSchema.safeParse('Fiction\u202e').success).toBe(false);
    expect(PUBLIC_CATEGORY_ASSIGNMENT_LIMIT).toBe(3);
  });
});
