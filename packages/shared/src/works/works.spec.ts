import { describe, expect, it } from 'vitest';

import {
  CATALOG_SOURCE_LINKS,
  catalogListQuerySchema,
  isWorkParseCompleted,
  isWorkReadable,
  personalWorkUpdateSchema,
  personalWorkUploadResultSchema,
  WORK_PROCESSING_STATUSES,
  workAvailability,
  type WorkProcessingStatus,
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

  it('judges parse-completed Works readable only when they have parts', () => {
    expect(isWorkParseCompleted('parsed')).toBe(true);
    expect(isWorkParseCompleted('metadata')).toBe(true);
    expect(isWorkParseCompleted('ready')).toBe(true);
    expect(isWorkReadable('parsed', 1)).toBe(true);
    expect(isWorkReadable('metadata', 3)).toBe(true);
    expect(isWorkReadable('ready', 1)).toBe(true);
    expect(isWorkReadable('parsed', 0)).toBe(false);
    expect(isWorkReadable('metadata', 0)).toBe(false);
    for (const processingStatus of [
      'uploaded',
      'processing',
      'failed',
    ] as const satisfies readonly WorkProcessingStatus[]) {
      expect(isWorkParseCompleted(processingStatus)).toBe(false);
      expect(isWorkReadable(processingStatus, 4)).toBe(false);
    }
  });

  it('maps one availability bucket from pipeline status and part presence', () => {
    expect(workAvailability('parsed', 2)).toBe('ready');
    expect(workAvailability('metadata', 1)).toBe('ready');
    expect(workAvailability('ready', 1)).toBe('ready');
    expect(workAvailability('ready', 0)).toBe('processing');
    expect(workAvailability('parsed', 0)).toBe('processing');
    expect(workAvailability('uploaded', 4)).toBe('processing');
    expect(workAvailability('processing', 0)).toBe('processing');
    expect(workAvailability('failed', 4)).toBe('failed');
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
      coverAssetId: null,
      wordCount: null,
      estimatedMinutes: null,
      suggestedVocabSize: null,
      difficultyScore: null,
      statsProvenance: null,
      publishedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      originKind: 'privateOrigin',
    });

    expect(work.processingStatus).toBe('ready');
    expect(work.publishedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(work).not.toHaveProperty('originKind');
    expect(work).not.toHaveProperty('tags');
    expect(work).not.toHaveProperty('category');
    expect(work).not.toHaveProperty('sources');
  });

  it('retains Catalog list filters and safe Personal upload results', () => {
    expect(catalogListQuerySchema.parse({ q: '  book  ' }).q).toBe('book');
    expect(catalogListQuerySchema.parse({ q: '  ' }).q).toBeUndefined();
    expect(catalogListQuerySchema.parse({}).sourceLink).toBe('any');
    expect(catalogListQuerySchema.parse({ sourceLink: 'unlinked' }).sourceLink).toBe('unlinked');
    expect(catalogListQuerySchema.safeParse({ sourceLink: 'linked' }).success).toBe(false);
    expect(CATALOG_SOURCE_LINKS).toEqual(['any', 'unlinked']);
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

  it('accepts only owner-editable Personal Work metadata', () => {
    expect(personalWorkUpdateSchema.parse({ title: '  Title  ', author: 'Author' })).toEqual({
      title: 'Title',
      author: 'Author',
    });
    expect(personalWorkUpdateSchema.safeParse({ visibility: 'catalog' }).success).toBe(false);
    expect(personalWorkUpdateSchema.safeParse({ ownerUserId: 'other-user', title: 'Title' }).success).toBe(false);
    expect(personalWorkUpdateSchema.safeParse({}).success).toBe(false);
  });
});
