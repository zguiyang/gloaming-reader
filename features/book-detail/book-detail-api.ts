/**
 * Book detail data layer — library membership, parts, and reading progress only.
 * Reader parts fetch uses credentials: 'omit' so viewing detail does not create reading_state.
 */

import { useQuery } from '@tanstack/react-query';

import { DEFAULT_LOCALE } from '@/i18n';
import type { LibraryItem } from '@/shared/library';
import type { ReaderPartsData, ReadingState } from '@/shared/reader';
import { estimatedMinutesFromWordCount } from '@/shared/reading-stats';
import { type PartSummary } from '@/shared/works';

import {
  type BookChapter,
  type BookDetail,
  languageLabelFromCode,
  readingStatusFromState,
} from '@/features/book-detail/book-detail-model';
import { bookDetailQueryKey } from '@/features/book-detail/book-detail-query-key';
import { getLibraryItem } from '@/features/library/library-public';
import { getReadingState } from '@/features/reader/reader-api';
import { getWorkParts } from '@/features/reader/reader-parts-public';
import { ApiRequestError, formatApiError } from '@/lib/api-request';
import { coverUrlFromAssetId } from '@/lib/asset-url';

/** Re-exported so existing consumers keep one import site for the factory. */
export { bookDetailQueryKey };

function toIsoString(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return typeof value === 'string' ? value : value.toISOString();
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

export function toLibraryBookDetail(
  libraryItem: LibraryItem,
  partsData: ReaderPartsData | null,
  state: ReadingState | null,
): BookDetail {
  const parts = partsData?.parts ?? [];
  const progressRatio = state?.progressRatio ?? null;
  const readingStatus = state ? readingStatusFromState(state.status) : 'unread';
  const work = libraryItem.work;
  const metadata = libraryItem.personalMetadata;
  const totalWords = parts.reduce((total, part) => total + (part.wordCount ?? 0), 0);
  const estimatedMinutes =
    metadata?.estimatedMinutes ?? (totalWords > 0 ? estimatedMinutesFromWordCount(totalWords) : null);
  const difficultyScore = metadata?.difficultyScore ?? null;
  const language = metadata?.language ?? '';

  return {
    id: work.id,
    title: work.title,
    author: metadata?.author ?? '',
    difficultyScore,
    estimatedMinutes,
    suggestedVocabSize: metadata?.suggestedVocabSize ?? null,
    teaser: work.description,
    language,
    languageLabel: languageLabelFromCode(language, DEFAULT_LOCALE),
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
  const libraryItem = await getLibraryItem(workId, init);

  if (libraryItem.availability !== 'ready') {
    return { book: toLibraryBookDetail(libraryItem, null, libraryItem.state) };
  }

  const [partsData, state] = await Promise.all([getWorkParts(workId, init), getOptionalReadingState(workId, init)]);
  return { book: toLibraryBookDetail(libraryItem, partsData, state) };
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
