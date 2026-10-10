import { describe, expect, it } from 'vitest';

import type { ReaderPartData, ReaderPartsData, ReadingState } from '@gloaming/shared/reader';

import { getReaderBootstrapCommand, toReaderViewModel } from '@/features/reader/reader-api';

describe('reader bootstrap command', () => {
  it('opens completed state at the resolved part without restarting it', () => {
    expect(
      getReaderBootstrapCommand({
        stateStatus: 'completed',
        resolvedPartId: 'p2',
        preferredPartId: null,
      }),
    ).toEqual({ action: 'open', partId: 'p2' });
    expect(
      getReaderBootstrapCommand({
        stateStatus: 'completed',
        resolvedPartId: 'p1',
        preferredPartId: 'p1',
      }),
    ).toEqual({ action: 'open', partId: 'p1' });
  });
});

describe('toReaderViewModel anchor mapping', () => {
  const partsData: ReaderPartsData = {
    work: { id: 'w1', title: 'Work', description: 'Desc', coverAssetId: null, publishedAt: null },
    parts: [
      {
        id: 'p1',
        workId: 'w1',
        sortOrder: 0,
        kind: 'chapter',
        title: 'Chapter 1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        wordCount: 10,
        estimatedMinutes: 1,
      },
    ],
  };
  const partData: ReaderPartData = {
    work: { id: 'w1', title: 'Work', coverAssetId: null },
    part: { id: 'p1', workId: 'w1', sortOrder: 0, kind: 'chapter', title: 'Chapter 1', body: '<p>hi</p>' },
    audioAvailable: { us: false, uk: false },
  };
  const state: ReadingState = {
    status: 'in_progress',
    currentPartId: 'p1',
    completedThroughSortOrder: -1,
    anchor: { partId: 'p1', ratio: 0.5 },
    progressRatio: 0,
    totalPartCount: 1,
    lastReadAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
  };

  it('carries the paired within-chapter anchor into reader state', () => {
    expect(toReaderViewModel(partsData, partData, state).state?.anchor).toEqual({ partId: 'p1', ratio: 0.5 });
  });

  it('normalizes a missing anchor to null without affecting chapter progress', () => {
    const viewModel = toReaderViewModel(partsData, partData, { ...state, anchor: null });
    expect(viewModel.state?.anchor).toBeNull();
    expect(viewModel.state?.progressRatio).toBe(0);
  });
});
