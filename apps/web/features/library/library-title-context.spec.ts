import { describe, expect, it } from 'vitest';

import type { LibraryItem } from '@gloaming/shared/library';

import {
  duplicatedLibraryTitleKeys,
  libraryTitleContext,
  libraryTitleKey,
  publishedYear,
} from './library-title-context';

function item(overrides: {
  libraryItemKind: LibraryItem['libraryItemKind'];
  author?: string | null;
  publishedAt?: string | Date | null;
}): LibraryItem {
  return {
    work: {
      id: 'work-1',
      title: 'Walden',
      description: '',
      coverAssetId: null,
      publishedAt: overrides.publishedAt ?? null,
    },
    state: null,
    availability: 'ready',
    libraryItemKind: overrides.libraryItemKind,
    personalMetadata: overrides.libraryItemKind === 'personal' ? { author: overrides.author ?? '' } : null,
    canRemoveFromLibrary: overrides.libraryItemKind === 'saved_catalog',
    userTags: [],
  } as LibraryItem;
}

describe('libraryTitleKey', () => {
  it('normalizes case and whitespace for display-only comparison', () => {
    expect(libraryTitleKey('  Walden  ')).toBe('walden');
    expect(libraryTitleKey('WALDEN')).toBe(libraryTitleKey('walden'));
    expect(libraryTitleKey('The  Odyssey')).toBe(libraryTitleKey('The Odyssey'));
  });
});

describe('duplicatedLibraryTitleKeys', () => {
  it('returns only titles shared by more than one Work', () => {
    const keys = duplicatedLibraryTitleKeys(['Walden', 'walden', 'Emma', 'The Odyssey']);
    expect(keys).toEqual(new Set(['walden']));
  });

  it('returns an empty set when all titles are unique', () => {
    expect(duplicatedLibraryTitleKeys(['Walden', 'Emma'])).toEqual(new Set());
    expect(duplicatedLibraryTitleKeys([])).toEqual(new Set());
  });
});

describe('publishedYear', () => {
  it('reads the UTC year of an ISO string or Date', () => {
    expect(publishedYear('1854-07-09T00:00:00.000Z')).toBe(1854);
    expect(publishedYear(new Date(Date.UTC(1854, 6, 9)))).toBe(1854);
  });

  it('returns null when absent or unparsable instead of inventing a year', () => {
    expect(publishedYear(null)).toBeNull();
    expect(publishedYear('not-a-date')).toBeNull();
  });
});

describe('libraryTitleContext', () => {
  it('labels a Personal Work with origin and only projected author/year facts', () => {
    const parts = libraryTitleContext(
      item({ libraryItemKind: 'personal', author: 'Henry David Thoreau', publishedAt: '1854-07-09T00:00:00.000Z' }),
      'en-US',
    );
    expect(parts).toEqual(['My uploads', 'Henry David Thoreau', 'Published 1854']);
  });

  it('omits an empty author and a missing year rather than inventing them', () => {
    const parts = libraryTitleContext(item({ libraryItemKind: 'personal' }), 'en-US');
    expect(parts).toEqual(['My uploads']);
  });

  it('labels a saved Catalog Work with its origin kind only', () => {
    // Saved Catalog items project no author metadata; only the trustworthy origin kind shows.
    const parts = libraryTitleContext(item({ libraryItemKind: 'saved_catalog', author: 'ignored' }), 'zh-CN');
    expect(parts).toEqual(['已保存']);
  });
});
