import { describe, expect, it } from 'vitest';

import {
  catalogListQuerySchema,
  personalWorkUploadResultSchema,
  WORK_PROCESSING_STATUSES,
  workProcessingStatusSchema,
  workSchema,
} from './works.ts';

describe('work contracts', () => {
  it('keeps pipeline status separate from publication', () => {
    expect(WORK_PROCESSING_STATUSES).toEqual(['uploaded', 'processing', 'parsed', 'metadata', 'ready', 'failed']);
    for (const value of WORK_PROCESSING_STATUSES) {
      expect(workProcessingStatusSchema.parse(value)).toBe(value);
    }
    expect(workProcessingStatusSchema.safeParse('published').success).toBe(false);
    expect(workProcessingStatusSchema.safeParse('tts').success).toBe(false);
  });

  it('keeps the public Catalog Work contract independent of Admin provenance', () => {
    const work = workSchema.parse({
      id: 'work-1',
      title: 'Title',
      author: 'Author',
      description: '',
      language: 'en',
      processingStatus: 'ready',
      visibility: 'catalog',
      tags: [],
      category: null,
      sources: [],
      coverAssetId: null,
      wordCount: null,
      estimatedMinutes: null,
      suggestedVocabSize: null,
      difficultyScore: null,
      statsProvenance: null,
      publishedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      originKind: 'admin_epub',
    });

    expect(work.processingStatus).toBe('ready');
    expect(work.publishedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(work).not.toHaveProperty('originKind');
  });

  it('retains Catalog list filters and safe Personal upload results', () => {
    expect(catalogListQuerySchema.parse({ q: '  book  ' }).q).toBe('book');
    expect(catalogListQuerySchema.parse({ q: '  ' }).q).toBeUndefined();
    expect(personalWorkUploadResultSchema.parse({ id: 'work-1', title: 'Book', processingStatus: 'uploaded' })).toEqual(
      { id: 'work-1', title: 'Book', processingStatus: 'uploaded' },
    );
    expect(
      personalWorkUploadResultSchema.parse({
        id: 'work-1',
        title: 'Book',
        processingStatus: 'uploaded',
        storageKey: 'epub/private.epub',
      }),
    ).toEqual({ id: 'work-1', title: 'Book', processingStatus: 'uploaded' });
  });
});
