/**
 * Book detail data layer — catalog/shelf/parts + derived reading stats from API.
 * Reader parts fetch uses credentials: 'omit' so viewing detail does not create reading_state.
 */

import { useQuery } from '@tanstack/react-query';

import type { ReadingState } from '@gloaming/shared/reader';
import { difficultyLabelFromScore, estimatedMinutesFromWordCount } from '@gloaming/shared/reading-stats';
import type { ShelfItem } from '@gloaming/shared/shelf';
import { type PartSummary, type Work, workSchema } from '@gloaming/shared/works';

import {
  type BookChapter,
  type BookDetail,
  languageLabelFromCode,
  readingStatusFromProgress,
  teaserFromDescription,
} from '@/features/book-detail/book-detail-model';
import { getWorkParts } from '@/features/reader/reader-parts-public';
import { buildShelfItemMap, getShelf } from '@/features/shelf/shelf-public';
import { apiRequest, ApiRequestError, formatApiError } from '@/lib/api-request';
import { coverUrlFromAssetId } from '@/lib/asset-url';

async function getPublishedWork(workId: string, init?: { signal?: AbortSignal }): Promise<Work> {
  return apiRequest(`/api/catalog/works/${encodeURIComponent(workId)}`, {
    schema: workSchema,
    signal: init?.signal,
  });
}

export const bookDetailQueryKey = {
  all: ['book-detail'] as const,
  detail: (workId: string) => [...bookDetailQueryKey.all, workId] as const,
};

function toIsoString(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return typeof value === 'string' ? value : value.toISOString();
}

function resolveWorkReadingStats(
  work: Work,
  parts: PartSummary[],
): Pick<BookDetail, 'estimatedMinutes' | 'suggestedVocabSize' | 'difficultyScore' | 'difficultyLabel'> {
  let estimatedMinutes = work.estimatedMinutes;
  const suggestedVocabSize = work.suggestedVocabSize;
  const difficultyScore = work.difficultyScore;

  if (estimatedMinutes == null) {
    const partWordCounts = parts.map((part) => part.wordCount).filter((count): count is number => count != null);
    if (partWordCounts.length > 0) {
      const totalWords = partWordCounts.reduce((sum, count) => sum + count, 0);
      estimatedMinutes = estimatedMinutesFromWordCount(totalWords);
    }
  }

  return {
    estimatedMinutes,
    suggestedVocabSize,
    difficultyScore,
    difficultyLabel: difficultyScore != null ? difficultyLabelFromScore(difficultyScore) : null,
  };
}

function partStatsFields(part: PartSummary): Pick<BookChapter, 'estimatedMinutes' | 'wordCount'> {
  return {
    estimatedMinutes: part.estimatedMinutes ?? null,
    wordCount: part.wordCount ?? null,
  };
}

export function chaptersFromParts(parts: PartSummary[], state: ReadingState | null): BookChapter[] {
  const sorted = [...parts].sort((a, b) => a.sortOrder - b.sortOrder);
  const readingStatus = state ? readingStatusFromProgress(state.status, state.progressRatio) : 'unread';

  if (readingStatus === 'unread') {
    return sorted.map((part, i) => ({
      id: part.id,
      index: i + 1,
      title: part.title || `第 ${i + 1} 章`,
      ...partStatsFields(part),
      status: 'unread' as const,
    }));
  }

  if (readingStatus === 'completed') {
    return sorted.map((part, i) => ({
      id: part.id,
      index: i + 1,
      title: part.title || `第 ${i + 1} 章`,
      ...partStatsFields(part),
      status: 'read' as const,
    }));
  }

  const currentId = state?.currentPartId;

  return sorted.map((part, i) => {
    let status: BookChapter['status'] = 'unread';
    if (part.sortOrder <= (state?.completedThroughSortOrder ?? -1)) {
      status = 'read';
    } else if (part.id === currentId) {
      status = 'current';
    }
    return {
      id: part.id,
      index: i + 1,
      title: part.title || `第 ${i + 1} 章`,
      ...partStatsFields(part),
      status,
    };
  });
}

export function toBookDetail(work: Work, parts: PartSummary[], shelfItem: ShelfItem | undefined): BookDetail {
  const state = shelfItem?.state ?? null;
  const progressRatio = state?.progressRatio ?? null;
  const readingStatus = state ? readingStatusFromProgress(state.status, progressRatio) : 'unread';
  const teaser = teaserFromDescription(work.description);
  const readingStats = resolveWorkReadingStats(work, parts);

  return {
    id: work.id,
    title: work.title,
    author: work.author,
    difficultyScore: readingStats.difficultyScore,
    difficultyLabel: readingStats.difficultyLabel,
    category: work.tags[0] ?? '读物',
    tags: work.tags,
    estimatedMinutes: readingStats.estimatedMinutes,
    suggestedVocabSize: readingStats.suggestedVocabSize,
    teaser,
    sourceLabel: '官方',
    languageLabel: languageLabelFromCode(work.language),
    coverImageUrl: coverUrlFromAssetId(work.coverAssetId),
    shelfStatus: shelfItem ? 'on_shelf' : 'available',
    readingStatus,
    progressRatio: readingStatus === 'unread' ? null : progressRatio,
    lastReadAt: toIsoString(state?.lastReadAt),
    completedAt: toIsoString(state?.completedAt),
    chapters: chaptersFromParts(parts, state),
    relatedIds: [],
  };
}

export type BookDetailQueryResult = {
  book: BookDetail;
};

export async function fetchBookDetail(workId: string, init?: { signal?: AbortSignal }): Promise<BookDetailQueryResult> {
  const work = await getPublishedWork(workId, init);
  const [shelfData, partsData] = await Promise.all([
    getShelf(init).catch((error: unknown) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        return null;
      }
      throw error;
    }),
    getWorkParts(workId, init),
  ]);

  const shelfMap = shelfData ? buildShelfItemMap(shelfData) : new Map<string, ShelfItem>();
  const book = toBookDetail(work, partsData.parts, shelfMap.get(workId));
  return { book };
}

export function useBookDetailQuery(workId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: bookDetailQueryKey.detail(workId),
    queryFn: ({ signal }) => fetchBookDetail(workId, { signal }),
    enabled: options?.enabled ?? Boolean(workId),
  });
}

export const formatBookDetailApiError = formatApiError;
