/**
 * Unified recommendations client — book detail (and future surfaces) share this API.
 */

import { useQuery } from '@tanstack/react-query';

import { difficultyLabelFromScore } from '@gloaming/shared/reading-stats';
import {
  type RecommendationsData,
  recommendationsDataSchema,
  type RecommendationsQuery,
} from '@gloaming/shared/recommendations';
import type { Work } from '@gloaming/shared/works';

import {
  type BookDetail,
  coverUrlFromAssetId,
  languageLabelFromCode,
  teaserFromDescription,
} from '@/features/book-detail/book-detail-model';
import { apiRequest, formatApiError } from '@/lib/api-request';

export const recommendationsQueryKey = {
  all: ['recommendations'] as const,
  list: (params: RecommendationsQuery) => [...recommendationsQueryKey.all, params] as const,
};

function buildQuery(params: RecommendationsQuery): string {
  const search = new URLSearchParams();
  search.set('limit', String(params.limit));
  if (params.excludeWorkId) {
    search.set('excludeWorkId', params.excludeWorkId);
  }
  return search.toString();
}

export async function fetchRecommendations(
  params: RecommendationsQuery,
  init?: { signal?: AbortSignal },
): Promise<RecommendationsData> {
  return apiRequest(`/api/recommendations?${buildQuery(params)}`, {
    schema: recommendationsDataSchema,
    signal: init?.signal,
  });
}

export function workToRecommendationCard(work: Work): BookDetail {
  return {
    id: work.id,
    title: work.title,
    author: work.author,
    difficultyScore: work.difficultyScore,
    difficultyLabel: work.difficultyScore != null ? difficultyLabelFromScore(work.difficultyScore) : null,
    category: work.tags[0] ?? '读物',
    tags: work.tags,
    estimatedMinutes: work.estimatedMinutes,
    suggestedVocabSize: work.suggestedVocabSize,
    teaser: teaserFromDescription(work.description),
    sourceLabel: '官方',
    languageLabel: languageLabelFromCode(work.language),
    coverImageUrl: coverUrlFromAssetId(work.coverAssetId),
    shelfStatus: 'available',
    readingStatus: 'unread',
    progressRatio: null,
    lastReadAt: null,
    completedAt: null,
    chapters: [],
    relatedIds: [],
  };
}

export function useRecommendationsQuery(params: RecommendationsQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: recommendationsQueryKey.list(params),
    queryFn: ({ signal }) => fetchRecommendations(params, { signal }),
    enabled: options?.enabled ?? true,
  });
}

export const formatRecommendationsApiError = formatApiError;
