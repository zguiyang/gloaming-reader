import { describe, expect, it } from 'vitest';

import type { ShelfItem } from '@gloaming/shared/shelf';
import type { CatalogWork } from '@gloaming/shared/works';

import { resolveShelfStatus, tagFilterParam, toDiscoverItem } from '@/features/discover/discover-api';
import { DISCOVER_ALL_TAG } from '@/features/discover/discover-model';

const taxonomyTag = {
  id: 'tag-classic',
  names: { 'zh-CN': '经典', 'en-US': 'Classic' },
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

describe('toDiscoverItem', () => {
  it('maps cover URL, author, chapter count, and taxonomy tags from catalog work', () => {
    const item = toDiscoverItem(sampleWork());
    expect(item.coverImageUrl).toBe('/api/assets/asset-cover-1');
    expect(item.author).toBe('Jane Austen');
    expect(item.partCount).toBe(21);
    expect(item.tags[0]?.id).toBe('tag-classic');
    expect(item.shelfStatus).toBe('available');
  });

  it('omits cover URL and trims empty author', () => {
    const item = toDiscoverItem(sampleWork({ coverAssetId: null, author: '', partCount: 0 }));
    expect(item.coverImageUrl).toBeNull();
    expect(item.author).toBe('');
    expect(item.partCount).toBe(0);
  });
});

describe('tagFilterParam', () => {
  it('returns undefined for the all-tags sentinel', () => {
    expect(tagFilterParam(DISCOVER_ALL_TAG, [taxonomyTag])).toBeUndefined();
  });

  it('maps a selected tag id to the canonical catalog query label', () => {
    expect(tagFilterParam('tag-classic', [taxonomyTag])).toBe('Classic');
  });

  it('returns undefined when the selected tag id is unknown', () => {
    expect(tagFilterParam('missing-tag', [taxonomyTag])).toBeUndefined();
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
