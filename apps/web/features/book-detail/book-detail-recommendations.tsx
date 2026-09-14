'use client';

import { type Locale, t } from '@gloaming/i18n';
import type { RecommendationStrategy } from '@gloaming/shared/recommendations';

import {
  useRecommendationsQuery,
  workToRecommendationCard,
} from '@/features/book-detail/book-detail-recommendations-api';
import { BookDetailRelated } from '@/features/book-detail/book-detail-related';
import { authClient } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';

/** Detail related-rail default request size (UI slot). */
const BOOK_DETAIL_RECOMMENDATION_LIMIT = 4;

function titleForStrategy(strategy: RecommendationStrategy | undefined, locale: Locale): string {
  if (strategy === 'cold_start') {
    return t(locale, 'content.bookDetail.recommendationsColdStart');
  }
  return t(locale, 'content.bookDetail.recommendationsPersonalized');
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
  const { locale } = useLocale();
  const { data: authData, isPending: isAuthPending } = authClient.useSession();
  const isAuthenticated = Boolean(authData?.user);
  const query = useRecommendationsQuery({ limit, excludeWorkId }, { enabled: !isAuthPending && isAuthenticated });

  if (isAuthPending || !isAuthenticated || query.isPending || query.isError || !query.data?.items.length) {
    return null;
  }

  return (
    <BookDetailRelated
      books={query.data.items.map(workToRecommendationCard)}
      title={titleForStrategy(query.data.strategy, locale)}
      showDivider={showDivider}
    />
  );
}
