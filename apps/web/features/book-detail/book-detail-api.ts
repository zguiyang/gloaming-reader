/**
 * Book detail data layer — catalog/Library/parts + independently derived reading progress.
 * Reader parts fetch uses credentials: 'omit' so viewing detail does not create reading_state.
 */

import { useQuery } from '@tanstack/react-query';

import { DEFAULT_LOCALE } from '@gloaming/i18n';
import type { LibraryItem } from '@gloaming/shared/library';
import type { ReaderPartsData, ReadingState } from '@gloaming/shared/reader';
import { difficultyLabelFromScore, estimatedMinutesFromWordCount } from '@gloaming/shared/reading-stats';
import { type PartSummary, type Work, workAvailability, workSchema } from '@gloaming/shared/works';

import {
  type BookChapter,
  type BookDetail,
  languageLabelFromCode,
  readingStatusFromState,
  teaserFromDescription,
} from '@/features/book-detail/book-detail-model';
import { getLibrary } from '@/features/library/library-public';
import { getReadingState } from '@/features/reader/reader-api';
import { getWorkParts } from '@/features/reader/reader-parts-public';
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
  const readingStatus = state ? readingStatusFromState(state.status) : 'unread';

  if (readingStatus === 'unread') {
    return sorted.map((part, i) => ({
      id: part.id,
      index: i + 1,
      title: part.title?.trim() ?? '',
      ...partStatsFields(part),
      status: 'unread' as const,
    }));
  }

  if (readingStatus === 'completed') {
    return sorted.map((part, i) => ({
      id: part.id,
      index: i + 1,
      title: part.title?.trim() ?? '',
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
      title: part.title?.trim() ?? '',
      ...partStatsFields(part),
      status,
    };
  });
}

export function toBookDetail(
  work: Work,
  parts: PartSummary[],
  libraryItem: LibraryItem | null,
  state: ReadingState | null,
): BookDetail {
  const progressRatio = state?.progressRatio ?? null;
  const readingStatus = state ? readingStatusFromState(state.status) : 'unread';
  const teaser = teaserFromDescription(work.description);
  const readingStats = resolveWorkReadingStats(work, parts);
  const availability = workAvailability(work.processingStatus, parts.length);

  return {
    id: work.id,
    title: work.title,
    author: work.author,
    difficultyScore: readingStats.difficultyScore,
    difficultyLabel: readingStats.difficultyLabel,
    estimatedMinutes: readingStats.estimatedMinutes,
    suggestedVocabSize: readingStats.suggestedVocabSize,
    teaser,
    language: work.language,
    languageLabel: languageLabelFromCode(work.language, DEFAULT_LOCALE),
    coverImageUrl: coverUrlFromAssetId(work.coverAssetId),
    libraryStatus: libraryItem ? 'in_library' : 'available',
    libraryItem,
    availability,
    isReadable: availability === 'ready',
    readingStatus,
    progressRatio: readingStatus === 'unread' ? null : progressRatio,
    lastReadAt: toIsoString(state?.lastReadAt),
    completedAt: toIsoString(state?.completedAt),
    chapters: chaptersFromParts(parts, state),
    relatedIds: [],
  };
}

export function toPersonalBookDetail(
  libraryItem: LibraryItem,
  partsData: ReaderPartsData | null,
  state: ReadingState | null,
): BookDetail {
  const parts = partsData?.parts ?? [];
  const progressRatio = state?.progressRatio ?? null;
  const readingStatus = state ? readingStatusFromState(state.status) : 'unread';
  const work = libraryItem.work;
  const totalWords = parts.reduce((total, part) => total + (part.wordCount ?? 0), 0);
  const estimatedMinutes = totalWords > 0 ? estimatedMinutesFromWordCount(totalWords) : null;

  return {
    id: work.id,
    title: work.title,
    author: libraryItem.personalMetadata?.author ?? '',
    difficultyScore: null,
    difficultyLabel: null,
    estimatedMinutes,
    suggestedVocabSize: null,
    teaser: teaserFromDescription(work.description),
    language: '',
    languageLabel: languageLabelFromCode(''),
    coverImageUrl: coverUrlFromAssetId(work.coverAssetId),
    libraryStatus: 'in_library',
    libraryItem,
    availability: libraryItem.availability,
    isReadable: libraryItem.availability === 'ready' && parts.length > 0,
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
  const libraryData = await getLibrary(init).catch((error: unknown) => {
    if (error instanceof ApiRequestError && error.status === 401) {
      return null;
    }
    throw error;
  });
  const personalItem = libraryData?.items.find(
    (item) => item.work.id === workId && item.libraryItemKind === 'personal',
  );
  if (personalItem) {
    if (personalItem.availability !== 'ready') {
      return { book: toPersonalBookDetail(personalItem, null, personalItem.state) };
    }
    const [partsData, state] = await Promise.all([getWorkParts(workId, init), getOptionalReadingState(workId, init)]);
    return { book: toPersonalBookDetail(personalItem, partsData, state) };
  }

  const [work, partsData, state] = await Promise.all([
    getPublishedWork(workId, init),
    getWorkParts(workId, init),
    getOptionalReadingState(workId, init),
  ]);
  const libraryItem = libraryData?.items.find((item) => item.work.id === workId) ?? null;
  const book = toBookDetail(work, partsData.parts, libraryItem, state);
  return { book };
}

function getOptionalReadingState(workId: string, init?: { signal?: AbortSignal }): Promise<ReadingState | null> {
  return getReadingState(workId, init).catch((error: unknown) => {
    if (error instanceof ApiRequestError && error.status === 401) {
      return null;
    }
    throw error;
  });
}

export function useBookDetailQuery(workId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: bookDetailQueryKey.detail(workId),
    queryFn: ({ signal }) => fetchBookDetail(workId, { signal }),
    enabled: options?.enabled ?? Boolean(workId),
  });
}

export const formatBookDetailApiError = formatApiError;
