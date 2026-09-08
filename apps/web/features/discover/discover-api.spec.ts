import { describe, expect, it } from 'vitest';

import type { ShelfItem } from '@gloaming/shared/shelf';
import type { CatalogWork } from '@gloaming/shared/works';

import { resolveShelfStatus, toDiscoverItem } from '@/features/discover/discover-api';

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
    tags: ['Classic'],
    sources: ['Project Gutenberg'],
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
  it('maps cover URL, author, and chapter count from catalog work', () => {
    const item = toDiscoverItem(sampleWork());
    expect(item.coverImageUrl).toBe('/api/assets/asset-cover-1');
    expect(item.author).toBe('Jane Austen');
    expect(item.partCount).toBe(21);
    expect(item.shelfStatus).toBe('available');
  });

  it('omits cover URL and trims empty author', () => {
    const item = toDiscoverItem(sampleWork({ coverAssetId: null, author: '', partCount: 0 }));
    expect(item.coverImageUrl).toBeNull();
    expect(item.author).toBe('');
    expect(item.partCount).toBe(0);
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
