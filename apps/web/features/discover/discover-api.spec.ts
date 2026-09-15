import { describe, expect, it } from 'vitest';

import type { ShelfItem } from '@gloaming/shared/shelf';
import { catalogTaxonomyListDataSchema } from '@gloaming/shared/taxonomy';
import type { CatalogWork } from '@gloaming/shared/works';

import {
  buildDiscoverListQuery,
  discoverQueryKey,
  resolveShelfStatus,
  toDiscoverItem,
} from '@/features/discover/discover-api';
import { DISCOVER_PAGE_SIZE } from '@/features/discover/discover-model';

const taxonomyTag = {
  id: 'tag-classic',
  names: { 'zh-CN': '经典', 'en-US': 'Classic' },
  origin: 'manual' as const,
};

const taxonomyCategory = {
  id: 'cat-essays',
  names: { 'zh-CN': '随笔', 'en-US': 'Essays' },
  origin: 'manual' as const,
};

const taxonomySource = {
  id: 'source-gutenberg',
  name: 'Project Gutenberg',
  origin: 'extracted' as const,
  matchRule: 'gutenberg.org',
};

function sampleWork(overrides: Partial<CatalogWork> = {}): CatalogWork {
  return {
    id: 'work-1',
    title: 'Sample Title',
    author: '  Jane Austen  ',
    description: 'A published catalog work used in discover card mapping tests.',
    language: 'en',
    status: 'published',
    visibility: 'catalog',
    originKind: 'admin_epub',
    tags: [taxonomyTag],
    category: taxonomyCategory,
    sources: [taxonomySource],
    coverAssetId: 'asset-cover-1',
    wordCount: null,
    estimatedMinutes: null,
    suggestedVocabSize: null,
    difficultyScore: null,
    statsProvenance: null,
    publishedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    partCount: 21,
    ...overrides,
  };
}

describe('buildDiscoverListQuery', () => {
  it('sends stable category and comma-separated tag ids', () => {
    const qs = buildDiscoverListQuery({
      page: 2,
      pageSize: DISCOVER_PAGE_SIZE,
      category: 'cat-nonfiction',
      tag: ['tag-science', 'tag-history'],
      q: 'darwin',
    });
    const params = new URLSearchParams(qs);
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe(String(DISCOVER_PAGE_SIZE));
    expect(params.get('category')).toBe('cat-nonfiction');
    expect(params.get('tag')).toBe('tag-science,tag-history');
    expect(params.get('q')).toBe('darwin');
    expect(params.get('sortBy')).toBe('publishedAt');
    expect(params.get('sortOrder')).toBe('desc');
  });

  it('omits category and tag when unset', () => {
    const params = new URLSearchParams(buildDiscoverListQuery({}));
    expect(params.has('category')).toBe(false);
    expect(params.has('tag')).toBe(false);
  });
});

describe('discover catalog taxonomy endpoints', () => {
  const facet = { id: 'tag-science', names: { 'en-US': 'Science', 'zh-CN': '科学' } };

  it('parses /api/catalog/tags items with stable ids and localized names', () => {
    const payload = catalogTaxonomyListDataSchema.parse({ items: [facet] });
    expect(payload.items[0]?.id).toBe('tag-science');
  });

  it('parses /api/catalog/categories items with stable ids and localized names', () => {
    const payload = catalogTaxonomyListDataSchema.parse({
      items: [{ id: 'cat-essays', names: { 'en-US': 'Essays' } }],
    });
    expect(payload.items[0]?.names['en-US']).toBe('Essays');
  });

  it('uses independent React Query keys for tags and categories', () => {
    expect(discoverQueryKey.tags()).toEqual(['discover', 'tags']);
    expect(discoverQueryKey.categories()).toEqual(['discover', 'categories']);
    expect(discoverQueryKey.list({ tag: ['tag-a'] })).toEqual(['discover', 'list', { tag: ['tag-a'] }]);
  });
});

describe('toDiscoverItem', () => {
  it('maps cover URL, author, chapter count, tags, and category from catalog work', () => {
    const item = toDiscoverItem(sampleWork());
    expect(item.coverImageUrl).toBe('/api/assets/asset-cover-1');
    expect(item.author).toBe('Jane Austen');
    expect(item.partCount).toBe(21);
    expect(item.tags[0]?.id).toBe('tag-classic');
    expect(item.category?.id).toBe('cat-essays');
    expect(item.shelfStatus).toBe('available');
  });

  it('omits cover URL and trims empty author', () => {
    const item = toDiscoverItem(sampleWork({ coverAssetId: null, author: '', partCount: 0, category: null }));
    expect(item.coverImageUrl).toBeNull();
    expect(item.author).toBe('');
    expect(item.partCount).toBe(0);
    expect(item.category).toBeNull();
  });
});

describe('resolveShelfStatus', () => {
  it('marks in-progress when shelf progress is positive', () => {
    const shelfItem = {
      state: { status: 'in_progress', progressRatio: 12 },
    } as ShelfItem;
    expect(resolveShelfStatus(shelfItem)).toBe('in_progress');
  });
});
