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

import { type RelatedBookCard } from '@/features/book-detail/book-detail-model';
import { apiRequest, formatApiError } from '@/lib/api-request';
import { coverUrlFromAssetId } from '@/lib/asset-url';

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

export function workToRecommendationCard(work: Work): RelatedBookCard {
  return {
    id: work.id,
    title: work.title,
    tags: work.tags,
    coverImageUrl: coverUrlFromAssetId(work.coverAssetId),
    difficultyLabel: work.difficultyScore != null ? difficultyLabelFromScore(work.difficultyScore) : null,
    estimatedMinutes: work.estimatedMinutes,
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
