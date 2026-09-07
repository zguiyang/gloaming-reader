'use client';

import type { RecommendationStrategy } from '@gloaming/shared/recommendations';

import {
  useRecommendationsQuery,
  workToRecommendationCard,
} from '@/features/book-detail/book-detail-recommendations-api';
import { BookDetailRelated } from '@/features/book-detail/book-detail-related';
import { authClient } from '@/lib/auth';

/** Detail related-rail default request size (UI slot). */
const BOOK_DETAIL_RECOMMENDATION_LIMIT = 4;

function titleForStrategy(strategy: RecommendationStrategy | undefined): string {
  if (strategy === 'cold_start') {
    return '新上架';
  }
  return '您可能也会喜欢';
}

/**
 * Personalized recommendations via unified `/api/recommendations`.
 * Hidden when signed out (API requires auth).
 */
export function BookDetailRecommendations({
  excludeWorkId,
  limit = BOOK_DETAIL_RECOMMENDATION_LIMIT,
  showDivider = true,
}: {
  excludeWorkId?: string;
  limit?: number;
  showDivider?: boolean;
}) {
  const { data: authData, isPending: isAuthPending } = authClient.useSession();
  const isAuthenticated = Boolean(authData?.user);
  const query = useRecommendationsQuery({ limit, excludeWorkId }, { enabled: !isAuthPending && isAuthenticated });

  if (isAuthPending || !isAuthenticated || query.isPending || query.isError || !query.data?.items.length) {
    return null;
  }

  return (
    <BookDetailRelated
      books={query.data.items.map(workToRecommendationCard)}
      title={titleForStrategy(query.data.strategy)}
      showDivider={showDivider}
    />
  );
}
