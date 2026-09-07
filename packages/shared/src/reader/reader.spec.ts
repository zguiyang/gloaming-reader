import { describe, expect, it } from 'vitest';

import {
  computeChapterProgress,
  mergeReadingCompletion,
  mergeReadingPosition,
  NO_CHAPTERS_COMPLETED,
  updateReadingStateBodySchema,
} from './reader.ts';

describe('computeChapterProgress', () => {
  const tenParts = Array.from({ length: 10 }, (_, i) => ({ sortOrder: i }));

  it('returns 0 when no chapter completed', () => {
    expect(
      computeChapterProgress({
        status: 'in_progress',
        completedThroughSortOrder: NO_CHAPTERS_COMPLETED,
        parts: tenParts,
      }),
    ).toBe(0);
  });

  it('returns 10% after first chapter (sortOrder 0)', () => {
    expect(
      computeChapterProgress({
        status: 'in_progress',
        completedThroughSortOrder: 0,
        parts: tenParts,
      }),
    ).toBe(10);
  });

  it('returns 30% after three chapters', () => {
    expect(
      computeChapterProgress({
        status: 'in_progress',
        completedThroughSortOrder: 2,
        parts: tenParts,
      }),
    ).toBe(30);
  });

  it('returns 100 when completed', () => {
    expect(
      computeChapterProgress({
        status: 'completed',
        completedThroughSortOrder: 0,
        parts: tenParts,
      }),
    ).toBe(100);
  });

  it('handles single-part work', () => {
    expect(
      computeChapterProgress({
        status: 'in_progress',
        completedThroughSortOrder: NO_CHAPTERS_COMPLETED,
        parts: [{ sortOrder: 0 }],
      }),
    ).toBe(0);
    expect(
      computeChapterProgress({
        status: 'in_progress',
        completedThroughSortOrder: 0,
        parts: [{ sortOrder: 0 }],
      }),
    ).toBe(100);
  });
});

describe('updateReadingStateBodySchema', () => {
  it('requires partId for navigate', () => {
    expect(updateReadingStateBodySchema.safeParse({ action: 'navigate' }).success).toBe(false);
    expect(updateReadingStateBodySchema.parse({ action: 'navigate', partId: 'p1' })).toEqual({
      action: 'navigate',
      partId: 'p1',
    });
  });

  it('allows open without partId', () => {
    expect(updateReadingStateBodySchema.parse({ action: 'open' })).toEqual({ action: 'open' });
  });

  it('parses complete_chapter', () => {
    expect(updateReadingStateBodySchema.parse({ action: 'complete_chapter', nextPartId: 'p2' })).toEqual({
      action: 'complete_chapter',
      nextPartId: 'p2',
    });
  });

  it('accepts an optional revision for compare-and-swap updates', () => {
    expect(updateReadingStateBodySchema.parse({ action: 'navigate', partId: 'p2', expectedRevision: 3 })).toEqual({
      action: 'navigate',
      partId: 'p2',
      expectedRevision: 3,
    });
  });
});

describe('mergeReadingPosition', () => {
  it('uses a valid requested position and preserves it when absent', () => {
    expect(mergeReadingPosition({ action: 'navigate', currentPartId: 'p1', requestedPartId: 'p2' })).toBe('p2');
    expect(mergeReadingPosition({ action: 'open', currentPartId: 'p2' })).toBe('p2');
  });

  it('resets only when restart supplies the explicit first position', () => {
    expect(mergeReadingPosition({ action: 'restart', currentPartId: 'p3', restartPartId: 'p1' })).toBe('p1');
    expect(mergeReadingPosition({ action: 'restart', currentPartId: 'p3' })).toBe('p3');
  });
});

describe('mergeReadingCompletion', () => {
  it('keeps the furthest completion when an older write arrives', () => {
    expect(mergeReadingCompletion(3, 1)).toBe(3);
    expect(mergeReadingCompletion(1, 3)).toBe(3);
  });
});
