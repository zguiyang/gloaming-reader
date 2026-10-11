import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE } from '@gloaming/i18n';
import { workSchema } from '@gloaming/shared/works';

import { chaptersFromParts, toBookDetail, toPersonalBookDetail } from '@/features/book-detail/book-detail-api';
import {
  chapterOrdinalLabel,
  chapterStatusLabel,
  difficultyStarCount,
  formatChapterTitle,
  formatMinutes,
  formatRelativeReadTime,
  formatSuggestedVocabSize,
  languageLabelFromCode,
  primaryReadLabel,
  readingStatusFromState,
  teaserFromDescription,
} from '@/features/book-detail/book-detail-model';
import {
  legacyWorkDetailRedirect,
  resolveWorkDetailReturnTo,
  workDetailHref,
} from '@/lib/navigation/work-detail-return';

describe('book-detail-model', () => {
  it('maps reading status to primary CTA labels', () => {
    expect(primaryReadLabel('unread', DEFAULT_LOCALE)).toBe('开始阅读');
    expect(primaryReadLabel('in_progress', DEFAULT_LOCALE)).toBe('继续阅读');
    expect(primaryReadLabel('completed', DEFAULT_LOCALE)).toBe('再次阅读');
  });

  it('formats relative last-read times', () => {
    const now = new Date(2026, 7, 21, 10, 0, 0);
    const yesterday = new Date(2026, 7, 20, 20, 30, 0);
    expect(formatRelativeReadTime(yesterday.toISOString(), now, DEFAULT_LOCALE)).toMatch(/^昨天/);
    expect(formatRelativeReadTime(null, now, DEFAULT_LOCALE)).toBeNull();
  });

  it('formats minutes and suggested vocab size for stats', () => {
    expect(formatMinutes(15, DEFAULT_LOCALE)).toBe('15 分钟');
    expect(formatMinutes(90, DEFAULT_LOCALE)).toBe('1 小时 30 分');
    expect(formatMinutes(450, DEFAULT_LOCALE)).toBe('7 小时 30 分');
    expect(formatMinutes(null, DEFAULT_LOCALE)).toBeNull();
    expect(formatSuggestedVocabSize(3200)).toBe('3.2k');
    expect(formatSuggestedVocabSize(85000)).toBe('85k');
  });

  it('maps difficulty score to star counts', () => {
    expect(difficultyStarCount(2)).toBe(2);
    expect(difficultyStarCount(3)).toBe(3);
    expect(difficultyStarCount(5)).toBe(5);
  });

  it('derives reading status from independent reader state', () => {
    expect(readingStatusFromState('completed')).toBe('completed');
    expect(readingStatusFromState('in_progress')).toBe('in_progress');
    expect(readingStatusFromState(null)).toBe('unread');
  });

  it('builds teaser from description', () => {
    expect(teaserFromDescription('Short desc')).toBe('Short desc');
    expect(teaserFromDescription('')).toBe('');
  });

  it('maps language labels', () => {
    expect(languageLabelFromCode('en', DEFAULT_LOCALE)).toBe('英文原版');
    expect(languageLabelFromCode('zh', DEFAULT_LOCALE)).toBe('zh');
  });

  it('maps chapter status labels including unread', () => {
    expect(chapterStatusLabel('unread', DEFAULT_LOCALE)).toBe('未读');
    expect(chapterStatusLabel('current', DEFAULT_LOCALE)).toBe('正在阅读');
    expect(chapterStatusLabel('read', DEFAULT_LOCALE)).toBe('已读');
  });

  it('formats Arabic chapter ordinals without zero-pad', () => {
    expect(chapterOrdinalLabel(1)).toBe('1');
    expect(chapterOrdinalLabel(2)).toBe('2');
    expect(chapterOrdinalLabel(11)).toBe('11');
    expect(chapterOrdinalLabel(21)).toBe('21');
  });

  it('formats fallback chapter titles from index', () => {
    expect(formatChapterTitle({ index: 3, title: '' }, DEFAULT_LOCALE)).toBe('第 3 章');
    expect(formatChapterTitle({ index: 3, title: 'Custom' }, DEFAULT_LOCALE)).toBe('Custom');
  });
});

describe('Work detail return path', () => {
  it('allows Library, History, and the same Work Reader while preserving query', () => {
    expect(resolveWorkDetailReturnTo('/library?source=personal', 'w1')).toBe('/library?source=personal');
    expect(resolveWorkDetailReturnTo('/reading-history?range=week', 'w1')).toBe('/reading-history?range=week');
    expect(resolveWorkDetailReturnTo('/discover', 'w1')).toBe('/discover');
    expect(resolveWorkDetailReturnTo('/read/w1?part=p2', 'w1')).toBe('/read/w1?part=p2');
    expect(workDetailHref('w1', '/read/w1?part=p2')).toBe('/works/w1?returnTo=%2Fread%2Fw1%3Fpart%3Dp2');
    expect(legacyWorkDetailRedirect('w1', '/reading-history')).toBe('/works/w1?returnTo=%2Freading-history');
  });

  it('rejects external, malformed, cross-Work, and unapproved destinations', () => {
    for (const value of [
      'https://example.com',
      '//example.com',
      '/\\example.com',
      '/read/w2?part=p2',
      '/library/../discover',
      '/settings',
      '/library%ZZ',
      '/library#section',
    ]) {
      expect(resolveWorkDetailReturnTo(value, 'w1')).toBe('/library');
    }
    expect(resolveWorkDetailReturnTo(undefined, 'w1')).toBe('/library');
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

  it('marks all unread without reading state', () => {
    const chapters = chaptersFromParts(parts, null);
    expect(chapters.map((c) => c.status)).toEqual(['unread', 'unread', 'unread']);
    expect(chapters[0]?.estimatedMinutes).toBe(1);
    expect(chapters[0]?.wordCount).toBe(100);
  });

  it('marks current and prior chapters from reading progress', () => {
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
    processingStatus: 'ready' as const,
    visibility: 'catalog' as const,
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

    const book = toBookDetail(work, parts, null, null);
    expect(book.estimatedMinutes).toBe(2);
    expect(book.suggestedVocabSize).toBeNull();
    expect(book.language).toBe('en');
    expect(book).not.toHaveProperty('category');
    expect(book).not.toHaveProperty('tags');
    expect(book).not.toHaveProperty('sourceLabel');
    expect(workSchema.shape).not.toHaveProperty('tags');
    expect(workSchema.shape).not.toHaveProperty('category');
    expect(workSchema.shape).not.toHaveProperty('sources');
  });

  it('uses the Reading State status for detail copy even at zero percent', () => {
    const book = toBookDetail(work, [], null, {
      status: 'in_progress',
      currentPartId: null,
      completedThroughSortOrder: -1,
      progressRatio: 0,
      totalPartCount: 1,
      lastReadAt: '2026-08-28T12:00:00.000Z',
      completedAt: null,
    });
    expect(book.readingStatus).toBe('in_progress');
    expect(book.progressRatio).toBe(0);
  });
});

describe('toPersonalBookDetail', () => {
  const entry = {
    work: {
      id: 'personal-1',
      title: 'Private Book',
      description: 'A personal book',
      coverAssetId: null,
      publishedAt: null,
    },
    state: null,
    availability: 'ready' as const,
    libraryItemKind: 'personal' as const,
    personalMetadata: { author: 'Local Author' },
    canRemoveFromLibrary: false,
    userTags: [],
  };
  const parts = [
    {
      id: 'part-1',
      workId: 'personal-1',
      sortOrder: 0,
      kind: 'chapter' as const,
      title: 'Chapter One',
      wordCount: 500,
      estimatedMinutes: 3,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  it('keeps private Work identity, owner metadata, and zero-progress ReadingState', () => {
    const book = toPersonalBookDetail(
      entry,
      { work: entry.work, parts },
      {
        status: 'in_progress',
        currentPartId: 'part-1',
        completedThroughSortOrder: -1,
        progressRatio: 0,
        totalPartCount: 1,
        lastReadAt: '2026-08-28T12:00:00.000Z',
        completedAt: null,
      },
    );

    expect(book).toMatchObject({
      id: 'personal-1',
      author: 'Local Author',
      libraryStatus: 'in_library',
      readingStatus: 'in_progress',
      progressRatio: 0,
      isReadable: true,
    });
    expect(book.libraryItem?.libraryItemKind).toBe('personal');
    expect(book.chapters.map((chapter) => chapter.status)).toEqual(['current']);
  });

  it('does not expose a Reader action while a personal Work is processing', () => {
    const book = toPersonalBookDetail({ ...entry, availability: 'processing' }, null, null);
    expect(book.availability).toBe('processing');
    expect(book.isReadable).toBe(false);
    expect(book.chapters).toEqual([]);
  });
});
