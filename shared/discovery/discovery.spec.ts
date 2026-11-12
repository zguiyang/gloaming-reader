import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SOURCE_RECORD_SORT_BY,
  DISCOVERY_DEFAULT_LANGUAGE,
  discoverSaveBodySchema,
  discoveryFacetListDataSchema,
  discoveryFacetSchema,
  discoverySourceEnabledUpdateSchema,
  discoverySourceListDataSchema,
  discoverySourceSummarySchema,
  sourceRecordDetailSchema,
  sourceRecordItemSchema,
  sourceRecordListQuerySchema,
} from './discovery.ts';

const remoteCandidateBase = {
  sourceRecordId: null,
  linkedWorkId: null,
  sourceId: null,
  sourceKey: 'project_gutenberg',
  sourceType: 'gutenberg_opds',
  externalId: '1342',
  title: 'Pride and Prejudice',
  authors: [{ name: 'Austen, Jane' }],
  languages: ['en'],
  description: null,
  coverUrl: null,
  availability: 'available' as const,
  sourceUpdatedAt: null,
  lastSeenAt: null,
  createdAt: null,
  updatedAt: null,
  isSaveable: true,
  detailAvailable: false,
};

describe('on-demand discovery contracts', () => {
  it('defaults Discover language and accepts sourceKey/facetId filters', () => {
    expect(sourceRecordListQuerySchema.parse({}).language).toBe(DISCOVERY_DEFAULT_LANGUAGE);
    expect(sourceRecordListQuerySchema.parse({ language: '' }).language).toBe(DISCOVERY_DEFAULT_LANGUAGE);
    expect(sourceRecordListQuerySchema.parse({ sourceKey: 'project_gutenberg' }).sourceKey).toBe('project_gutenberg');
    expect(sourceRecordListQuerySchema.parse({ sourceKey: '' }).sourceKey).toBeUndefined();
    expect(sourceRecordListQuerySchema.parse({ facetId: '42' }).facetId).toBe('42');
    expect(sourceRecordListQuerySchema.parse({ facetId: '' }).facetId).toBeUndefined();
    expect(sourceRecordListQuerySchema.parse({}).sortBy).toBe(DEFAULT_SOURCE_RECORD_SORT_BY);
    expect(sourceRecordListQuerySchema.parse({}).page).toBe(1);
  });

  it('allows remote candidates with null sourceRecordId and persisted rows after Save', () => {
    const remote = sourceRecordItemSchema.parse(remoteCandidateBase);
    expect(remote.sourceRecordId).toBeNull();
    expect(remote.linkedWorkId).toBeNull();

    const saved = sourceRecordItemSchema.parse({
      ...remoteCandidateBase,
      sourceRecordId: 'sr-1',
      sourceId: 'src-1',
      linkedWorkId: 'work-42',
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:00.000Z',
    });
    expect(saved.sourceRecordId).toBe('sr-1');
    expect(saved.linkedWorkId).toBe('work-42');
  });

  it('requires an explicit saveability marker on every SourceRecord item', () => {
    const { isSaveable: _omitted, ...missing } = remoteCandidateBase;
    expect(() => sourceRecordItemSchema.parse(missing)).toThrow();
    expect(sourceRecordItemSchema.parse({ ...remoteCandidateBase, isSaveable: false }).isSaveable).toBe(false);
  });

  it('keeps detailAvailable a required boolean that defaults legacy payloads to false', () => {
    expect(sourceRecordItemSchema.parse(remoteCandidateBase).detailAvailable).toBe(false);
    expect(sourceRecordItemSchema.parse({ ...remoteCandidateBase, detailAvailable: true }).detailAvailable).toBe(true);
    const { detailAvailable: _omitted, ...legacy } = remoteCandidateBase;
    expect(sourceRecordItemSchema.parse(legacy).detailAvailable).toBe(false);
    expect(() => sourceRecordItemSchema.parse({ ...remoteCandidateBase, detailAvailable: 'yes' })).toThrow();
  });

  it('does not project local public categories on Discover items', () => {
    const item = sourceRecordItemSchema.parse({
      ...remoteCandidateBase,
      categories: [{ id: 'cat-1', name: 'Romance' }],
    });
    expect(item).not.toHaveProperty('categories');
  });

  it('validates detail payloads with content candidates and source meta', () => {
    const detail = sourceRecordDetailSchema.parse({
      ...remoteCandidateBase,
      rightsStatement: 'Public domain in the USA.',
      contentCandidates: [
        {
          format: 'epub',
          url: 'https://www.gutenberg.org/ebooks/1342.epub.images',
          mimeType: 'application/epub+zip',
        },
      ],
      sourceMeta: { subjects: ['England -- Fiction'], bookshelves: ['Category: Best Books Ever Listings'] },
    });
    expect(detail.contentCandidates).toHaveLength(1);
    expect(detail.sourceMeta.subjects?.[0]).toBe('England -- Fiction');
  });

  it('validates source-native facets and Discover save body', () => {
    const facet = discoveryFacetSchema.parse({
      id: '98',
      name: 'Best Books Ever Listings',
      sourceKey: 'project_gutenberg',
    });
    expect(discoveryFacetListDataSchema.parse({ items: [facet] }).items).toHaveLength(1);
    expect(discoverSaveBodySchema.parse({ sourceKey: 'project_gutenberg', externalId: '1342' })).toEqual({
      sourceKey: 'project_gutenberg',
      externalId: '1342',
    });
    expect(() => discoverSaveBodySchema.parse({ sourceKey: '', externalId: '1342' })).toThrow();
  });

  it('validates lightweight discovery source management DTOs', () => {
    const source = discoverySourceSummarySchema.parse({
      sourceKey: 'project_gutenberg',
      sourceType: 'gutenberg_opds',
      enabled: true,
    });
    expect(discoverySourceListDataSchema.parse({ items: [source] }).items).toHaveLength(1);
    expect(discoverySourceEnabledUpdateSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });
});
