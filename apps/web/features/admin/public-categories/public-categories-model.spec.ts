import { describe, expect, it } from 'vitest';

import type { PublicCategoryManagementItem, SourceRecordItem } from '@gloaming/shared/discovery';

import {
  canAssignCategoryToRecord,
  categoryDisplayName,
  categoryLocaleLabelEntries,
  categoryProvenanceKey,
  filterPublicCategories,
  isAssignmentSearchReady,
  isCategoryAssignedToRecord,
  isCategoryFullyLocalized,
  localeDisplayLabel,
  matchesPublicCategorySearch,
  missingCategoryLocales,
  normalizeAssignmentSearchTerm,
  paginatePublicCategories,
  PUBLIC_CATEGORY_ADMIN_PAGE_SIZE,
  PUBLIC_CATEGORY_ASSIGNMENT_SEARCH_MIN_CHARS,
  resolveSelectedCategoryId,
  sortPublicCategories,
  sourceRecordAuthorNames,
} from './public-categories-model';

function sampleCategory(overrides: Partial<PublicCategoryManagementItem> = {}): PublicCategoryManagementItem {
  return {
    id: 'cat-1',
    createdBy: 'manual',
    sourceLocale: 'zh-CN',
    meaning: null,
    manualLocales: ['zh-CN'],
    localizedNames: { 'zh-CN': '科幻' },
    aliases: [],
    recordCount: 0,
    ...overrides,
  };
}

function sampleRecord(overrides: Partial<SourceRecordItem> = {}): SourceRecordItem {
  return {
    sourceRecordId: 'sr-1',
    linkedWorkId: null,
    sourceId: 'source-1',
    sourceKey: 'gutenberg',
    sourceType: 'gutenberg',
    externalId: '1342',
    title: 'Pride and Prejudice',
    authors: [{ name: '  Jane Austen  ' }],
    languages: ['en'],
    description: null,
    coverUrl: null,
    availability: 'available',
    sourceUpdatedAt: null,
    lastSeenAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    categories: [],
    ...overrides,
  };
}

describe('categoryDisplayName', () => {
  it('uses the requested locale when present', () => {
    const category = sampleCategory({ localizedNames: { 'zh-CN': '科幻', 'en-US': 'Science Fiction' } });
    expect(categoryDisplayName(category, 'en-US')).toBe('Science Fiction');
  });

  it('falls back to the canonical/source locale without claiming a translation', () => {
    const category = sampleCategory({ sourceLocale: 'zh-CN', localizedNames: { 'zh-CN': '科幻' } });
    expect(categoryDisplayName(category, 'en-US')).toBe('科幻');
  });

  it('falls back to any available label, then the stable id', () => {
    const foreign = sampleCategory({ sourceLocale: null, localizedNames: { 'fr-FR': 'Roman' } });
    expect(categoryDisplayName(foreign, 'en-US')).toBe('Roman');
    const bare = sampleCategory({ sourceLocale: null, localizedNames: {} });
    expect(categoryDisplayName(bare, 'en-US')).toBe('cat-1');
  });
});

describe('matchesPublicCategorySearch', () => {
  const category = sampleCategory({
    id: 'cat-scifi',
    localizedNames: { 'zh-CN': ' 科幻 ', 'en-US': 'Science Fiction' },
  });

  it('matches the resolved name, any localized label, and the id', () => {
    expect(matchesPublicCategorySearch(category, 'zh-CN', '科幻')).toBe(true);
    expect(matchesPublicCategorySearch(category, 'zh-CN', 'science')).toBe(true);
    expect(matchesPublicCategorySearch(category, 'zh-CN', 'cat-scifi')).toBe(true);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(matchesPublicCategorySearch(category, 'zh-CN', '  SCIENCE   FICTION ')).toBe(true);
    expect(matchesPublicCategorySearch(category, 'zh-CN', 'no-match')).toBe(false);
  });

  it('matches everything for a blank term', () => {
    expect(matchesPublicCategorySearch(category, 'zh-CN', '   ')).toBe(true);
  });
});

describe('filter and sort', () => {
  const categories = [
    sampleCategory({ id: 'b', localizedNames: { 'zh-CN': '乙' } }),
    sampleCategory({ id: 'a', localizedNames: { 'zh-CN': '甲' } }),
  ];

  it('filters by term and keeps order otherwise', () => {
    expect(filterPublicCategories(categories, 'zh-CN', '甲').map((item) => item.id)).toEqual(['a']);
    expect(filterPublicCategories(categories, 'zh-CN', '')).toHaveLength(2);
  });

  it('sorts by resolved display name then stable id', () => {
    expect(sortPublicCategories(categories, 'zh-CN').map((item) => item.id)).toEqual(['a', 'b']);
    const sameName = [
      sampleCategory({ id: 'z', localizedNames: { 'zh-CN': '同名' } }),
      sampleCategory({ id: 'a', localizedNames: { 'zh-CN': '同名' } }),
    ];
    expect(sortPublicCategories(sameName, 'zh-CN').map((item) => item.id)).toEqual(['a', 'z']);
  });
});

describe('paginatePublicCategories', () => {
  const categories = Array.from({ length: 20 }, (_, index) =>
    sampleCategory({ id: `cat-${index}`, localizedNames: { 'zh-CN': `分类 ${index}` } }),
  );

  it('returns a bounded page and stable pagination meta', () => {
    const first = paginatePublicCategories(categories, 1);
    expect(first.items).toHaveLength(PUBLIC_CATEGORY_ADMIN_PAGE_SIZE);
    expect(first.pagination).toMatchObject({ page: 1, pageSize: PUBLIC_CATEGORY_ADMIN_PAGE_SIZE, total: 20 });
  });

  it('clamps an out-of-range page to the last page', () => {
    const last = paginatePublicCategories(categories, 99);
    expect(last.pagination.page).toBe(last.pagination.totalPages);
    expect(last.items.length).toBeGreaterThan(0);
  });

  it('clamps a page below one', () => {
    expect(paginatePublicCategories(categories, 0).pagination.page).toBe(1);
  });
});

describe('resolveSelectedCategoryId', () => {
  const categories = [sampleCategory({ id: 'cat-1' }), sampleCategory({ id: 'cat-2' })];

  it('keeps a still-valid selection', () => {
    expect(resolveSelectedCategoryId(categories, 'cat-2')).toBe('cat-2');
  });

  it('falls back to the first id for a stale selection', () => {
    expect(resolveSelectedCategoryId(categories, 'missing')).toBe('cat-1');
  });

  it('returns null for an empty list', () => {
    expect(resolveSelectedCategoryId([], 'cat-1')).toBeNull();
  });
});

describe('localized label state', () => {
  it('reports missing supported locales and manual provenance', () => {
    const category = sampleCategory({ localizedNames: { 'zh-CN': '科幻' }, manualLocales: ['zh-CN'] });
    expect(missingCategoryLocales(category)).toEqual(['en-US']);
    expect(isCategoryFullyLocalized(category)).toBe(false);
    expect(categoryLocaleLabelEntries(category)).toEqual([
      { locale: 'zh-CN', name: '科幻', isMissing: false, isManual: true },
      { locale: 'en-US', name: null, isMissing: true, isManual: false },
    ]);
  });

  it('is complete when every supported locale has a label', () => {
    const category = sampleCategory({ localizedNames: { 'zh-CN': '科幻', 'en-US': 'Science Fiction' } });
    expect(missingCategoryLocales(category)).toEqual([]);
    expect(isCategoryFullyLocalized(category)).toBe(true);
  });
});

describe('provenance and locale labels', () => {
  it('maps provenance to i18n keys', () => {
    expect(categoryProvenanceKey('manual')).toBe('admin.publicCategories.provenance.manual');
    expect(categoryProvenanceKey('ai')).toBe('admin.publicCategories.provenance.ai');
  });

  it('labels known locales and passes unknown tags through', () => {
    expect(localeDisplayLabel('zh-CN', 'en-US')).toBe('简体中文');
    expect(localeDisplayLabel('en-US', 'en-US')).toBe('English');
    expect(localeDisplayLabel('fr-FR', 'en-US')).toBe('fr-FR');
  });
});

describe('source record helpers', () => {
  it('joins trimmed author names', () => {
    expect(sourceRecordAuthorNames(sampleRecord({ authors: [{ name: ' A ' }, { name: '' }, { name: 'B' }] }))).toBe(
      'A, B',
    );
  });

  it('detects the assigned pair and the assignment cap', () => {
    const assigned = sampleRecord({ categories: [{ id: 'cat-1', name: '科幻' }] });
    expect(isCategoryAssignedToRecord(assigned, 'cat-1')).toBe(true);
    expect(canAssignCategoryToRecord(assigned, 'cat-1')).toBe(false);
    expect(canAssignCategoryToRecord(assigned, 'cat-2')).toBe(true);

    const capped = sampleRecord({
      categories: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
    });
    expect(canAssignCategoryToRecord(capped, 'cat-1')).toBe(false);
  });

  it('gates the candidate search on a minimum term length', () => {
    expect(PUBLIC_CATEGORY_ASSIGNMENT_SEARCH_MIN_CHARS).toBe(2);
    expect(normalizeAssignmentSearchTerm('  sci  ')).toBe('sci');
    expect(isAssignmentSearchReady('a')).toBe(false);
    expect(isAssignmentSearchReady(' ab ')).toBe(true);
  });
});
