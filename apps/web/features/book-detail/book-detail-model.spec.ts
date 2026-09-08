import { describe, expect, it } from 'vitest';

import { chaptersFromParts, toBookDetail } from '@/features/book-detail/book-detail-api';
import {
  chapterOrdinalLabel,
  chapterStatusLabel,
  difficultyStarCount,
  formatMinutes,
  formatRelativeReadTime,
  formatSuggestedVocabSize,
  languageLabelFromCode,
  primaryReadLabel,
  readingStatusFromProgress,
  teaserFromDescription,
} from '@/features/book-detail/book-detail-model';

describe('book-detail-model', () => {
  it('maps reading status to primary CTA labels', () => {
    expect(primaryReadLabel('unread')).toBe('开始阅读');
    expect(primaryReadLabel('in_progress')).toBe('继续阅读');
    expect(primaryReadLabel('completed')).toBe('再次阅读');
  });

  it('formats relative last-read times', () => {
    const now = new Date(2026, 7, 21, 10, 0, 0);
    const yesterday = new Date(2026, 7, 20, 20, 30, 0);
    expect(formatRelativeReadTime(yesterday.toISOString(), now)).toMatch(/^昨天/);
    expect(formatRelativeReadTime(null, now)).toBeNull();
  });

  it('formats minutes and suggested vocab size for stats', () => {
    expect(formatMinutes(15)).toBe('15 分钟');
    expect(formatMinutes(90)).toBe('1 小时 30 分');
    expect(formatMinutes(450)).toBe('7 小时 30 分');
    expect(formatMinutes(null)).toBeNull();
    expect(formatSuggestedVocabSize(3200)).toBe('3.2k');
    expect(formatSuggestedVocabSize(85000)).toBe('85k');
  });

  it('maps difficulty score to star counts', () => {
    expect(difficultyStarCount(2)).toBe(2);
    expect(difficultyStarCount(3)).toBe(3);
    expect(difficultyStarCount(5)).toBe(5);
  });

  it('derives reading status from shelf/reader state', () => {
    expect(readingStatusFromProgress('completed', 100)).toBe('completed');
    expect(readingStatusFromProgress('in_progress', 40)).toBe('in_progress');
    expect(readingStatusFromProgress('in_progress', 0)).toBe('unread');
    expect(readingStatusFromProgress(null, null)).toBe('unread');
  });

  it('builds teaser from description', () => {
    expect(teaserFromDescription('Short desc')).toBe('Short desc');
    expect(teaserFromDescription('')).toBe('');
  });

  it('maps language labels', () => {
    expect(languageLabelFromCode('en')).toBe('英文原版');
    expect(languageLabelFromCode('zh')).toBe('zh');
  });
  it('maps chapter status labels including unread', () => {
    expect(chapterStatusLabel('unread')).toBe('未读');
    expect(chapterStatusLabel('current')).toBe('正在阅读');
    expect(chapterStatusLabel('read')).toBe('已读');
  });

  it('formats Arabic chapter ordinals without zero-pad', () => {
    expect(chapterOrdinalLabel(1)).toBe('1');
    expect(chapterOrdinalLabel(2)).toBe('2');
    expect(chapterOrdinalLabel(11)).toBe('11');
    expect(chapterOrdinalLabel(21)).toBe('21');
  });
});

describe('chaptersFromParts', () => {
  const parts = [
    {
      id: 'p1',
      workId: 'w',
      sortOrder: 0,
      kind: 'chapter' as const,
      title: 'One',
      wordCount: 100,
      estimatedMinutes: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'p2',
      workId: 'w',
      sortOrder: 1,
      kind: 'chapter' as const,
      title: 'Two',
      wordCount: 200,
      estimatedMinutes: 2,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'p3',
      workId: 'w',
      sortOrder: 2,
      kind: 'chapter' as const,
      title: 'Three',
      wordCount: null,
      estimatedMinutes: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  it('marks all unread without shelf state', () => {
    const chapters = chaptersFromParts(parts, null);
    expect(chapters.map((c) => c.status)).toEqual(['unread', 'unread', 'unread']);
    expect(chapters[0]?.estimatedMinutes).toBe(1);
    expect(chapters[0]?.wordCount).toBe(100);
  });

  it('marks current and prior chapters from shelf progress', () => {
    const chapters = chaptersFromParts(parts, {
      status: 'in_progress',
      currentPartId: 'p2',
      completedThroughSortOrder: 0,
      progressRatio: 33,
      totalPartCount: 3,
      lastReadAt: '2026-08-28T12:00:00.000Z',
      completedAt: null,
    });
    expect(chapters.map((c) => c.status)).toEqual(['read', 'current', 'unread']);
  });

  it('marks all read when completed', () => {
    const chapters = chaptersFromParts(parts, {
      status: 'completed',
      currentPartId: 'p3',
      completedThroughSortOrder: 2,
      progressRatio: 100,
      totalPartCount: 3,
      lastReadAt: '2026-08-28T12:00:00.000Z',
      completedAt: '2026-08-28T12:00:00.000Z',
    });
    expect(chapters.every((c) => c.status === 'read')).toBe(true);
  });
});

describe('toBookDetail', () => {
  const work = {
    id: 'w1',
    title: 'Test Book',
    author: 'Author',
    description: 'Desc',
    language: 'en',
    status: 'published' as const,
    visibility: 'catalog' as const,
    originKind: 'admin_epub' as const,
    tags: ['Fiction'],
    sources: ['Gutenberg'],
    coverAssetId: null,
    wordCount: null,
    estimatedMinutes: null,
    suggestedVocabSize: null,
    difficultyScore: null,
    statsProvenance: null,
    publishedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('derives estimated minutes from part word counts when work stats are missing', () => {
    const parts = [
      {
        id: 'p1',
        workId: 'w1',
        sortOrder: 0,
        kind: 'chapter' as const,
        title: 'One',
        wordCount: 400,
        estimatedMinutes: 2,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ];

    const book = toBookDetail(work, parts, undefined);
    expect(book.estimatedMinutes).toBe(2);
    expect(book.suggestedVocabSize).toBeNull();
  });
});
