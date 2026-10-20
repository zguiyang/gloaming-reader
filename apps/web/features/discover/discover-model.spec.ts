import { describe, expect, it } from 'vitest';

import type { SourceRecordItem } from '@gloaming/shared/discovery';
import type { CatalogWork } from '@gloaming/shared/works';

import {
  categoryDisplayName,
  formatSourceRecordAuthors,
  hasActiveDiscoverFilter,
  toDiscoverItem,
  toDiscoverLegacyWork,
} from '@/features/discover/discover-model';

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
    coverUrl: 'https://example.test/cover.jpg',
    availability: 'available',
    sourceUpdatedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    categories: [{ id: 'cat-1', name: 'Classics' }],
    isSaveable: true,
    detailAvailable: false,
    ...overrides,
  };
}

function sampleWork(overrides: Partial<CatalogWork> = {}): CatalogWork {
  return {
    id: 'work-1',
    title: 'Published Work',
    author: '  Legacy Author  ',
    description: '',
    language: 'en',
    processingStatus: 'ready',
    visibility: 'catalog',
    coverAssetId: 'asset-1',
    wordCount: null,
    estimatedMinutes: null,
    suggestedVocabSize: null,
    difficultyScore: null,
    statsProvenance: null,
    publishedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    partCount: 12,
    ...overrides,
  };
}

describe('Discover model', () => {
  it('maps the SourceRecord identity, never a ReadingWork id', () => {
    const item = toDiscoverItem(sampleRecord());
    expect(item).toEqual({
      id: 'sr-1',
      linkedWorkId: null,
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      coverImageUrl: 'https://example.test/cover.jpg',
      categories: [{ id: 'cat-1', name: 'Classics' }],
      isSaveable: true,
      detailAvailable: false,
    });
    expect(item).not.toHaveProperty('workId');
    expect(item).not.toHaveProperty('partCount');
  });

  it('keeps the linked ReadingWork id separate from the Discover identity', () => {
    const item = toDiscoverItem(sampleRecord({ linkedWorkId: 'work-42' }));
    expect(item.id).toBe('sr-1');
    expect(item.linkedWorkId).toBe('work-42');
    // A linked id alone never opens the detail entry.
    expect(item.detailAvailable).toBe(false);
  });

  it('carries the server detail-availability decision through the Discover mapping', () => {
    expect(toDiscoverItem(sampleRecord({ detailAvailable: true })).detailAvailable).toBe(true);
    expect(toDiscoverItem(sampleRecord({ detailAvailable: false })).detailAvailable).toBe(false);
  });

  it('treats a payload without detailAvailable as no detail entry', () => {
    const legacyRecord: Partial<SourceRecordItem> = { ...sampleRecord({ detailAvailable: true }) };
    // Older servers/caches may not carry the field: that must read as `false`,
    // never as an implicit entry.
    delete legacyRecord.detailAvailable;
    expect(toDiscoverItem(legacyRecord as SourceRecordItem).detailAvailable).toBe(false);
  });

  it('carries the saveability marker through the Discover mapping', () => {
    expect(toDiscoverItem(sampleRecord({ isSaveable: true })).isSaveable).toBe(true);
    expect(toDiscoverItem(sampleRecord({ isSaveable: false })).isSaveable).toBe(false);
  });

  it('keeps an empty author list readable and drops blank names', () => {
    expect(formatSourceRecordAuthors({ authors: [{ name: ' ' }, { name: 'Ada' }] })).toBe('Ada');
    expect(formatSourceRecordAuthors({ authors: [] })).toBe('');
  });

  it('resolves a safe localized category label', () => {
    expect(categoryDisplayName({ id: 'cat-1', name: ' 科幻 ' })).toBe('科幻');
    expect(categoryDisplayName({ id: 'cat-2', name: '   ' })).toBe('cat-2');
  });

  it('detects an active category or query filter', () => {
    expect(hasActiveDiscoverFilter({ query: '', categoryId: null })).toBe(false);
    expect(hasActiveDiscoverFilter({ query: '  ', categoryId: null })).toBe(false);
    expect(hasActiveDiscoverFilter({ query: 'austen', categoryId: null })).toBe(true);
    expect(hasActiveDiscoverFilter({ query: '', categoryId: 'cat-1' })).toBe(true);
  });

  it('projects a published Catalog Work into the compatibility card row', () => {
    expect(toDiscoverLegacyWork(sampleWork(), '/api/assets/asset-1')).toEqual({
      id: 'work-1',
      title: 'Published Work',
      author: 'Legacy Author',
      partCount: 12,
      coverImageUrl: '/api/assets/asset-1',
    });
  });
});
