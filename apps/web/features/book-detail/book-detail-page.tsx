'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import { AUTH_ROUTES } from '@/constants';
import { useAuthDialog, useRequireAuth } from '@/features/auth';
import {
  bookDetailQueryKey,
  formatBookDetailApiError,
  useBookDetailQuery,
} from '@/features/book-detail/book-detail-api';
import { BookDetailHero, BookDetailMobileProgress, BookDetailStickyCta } from '@/features/book-detail/book-detail-hero';
import type { BookDetail } from '@/features/book-detail/book-detail-model';
import { BookDetailRecommendations } from '@/features/book-detail/book-detail-recommendations';
import { recommendationsQueryKey } from '@/features/book-detail/book-detail-recommendations-api';
import { BookDetailStats } from '@/features/book-detail/book-detail-stats';
import { BookDetailToc } from '@/features/book-detail/book-detail-toc';
import { BookDetailUnavailable } from '@/features/book-detail/book-detail-unavailable';
import { useUserTagsQuery } from '@/features/library/library-api';
import { useAddToLibraryMutation } from '@/features/library/library-client';
import { LibraryWorkManagement } from '@/features/library/library-work-management';
import { formatApiError, isUnauthorizedError } from '@/lib/api-request';
import { useLocale } from '@/lib/locale-context';
import { workDetailReturnLabelKey } from '@/lib/navigation/work-detail-return';
import { cn } from '@/lib/utils';

function BookDetailSkeleton() {
  return (
    <div className="flex w-full flex-col gap-8 py-8" aria-hidden>
      <div className="h-8 w-32 animate-pulse rounded bg-surface-container-high" />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
        <div className="mx-auto aspect-[2/3] w-48 animate-pulse rounded-sm bg-surface-container-high md:col-span-4" />
        <div className="space-y-4 md:col-span-8">
          <div className="h-10 w-3/4 animate-pulse rounded bg-surface-container-high" />
          <div className="h-6 w-1/2 animate-pulse rounded bg-surface-container-high" />
        </div>
      </div>
    </div>
  );
}

function BookDetailView({ book, returnTo }: { book: BookDetail; returnTo: string }) {
  const { locale } = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openLogin } = useAuthDialog();
  const requireAuth = useRequireAuth();
  const addToLibrary = useAddToLibraryMutation();
  const userTags = useUserTagsQuery({ enabled: Boolean(book.libraryItem) });
  const isInLibrary = book.libraryStatus === 'in_library';
  const returnLabel = t(locale, workDetailReturnLabelKey(returnTo));

  function handleAddToLibrary() {
    if (!requireAuth({ reason: 'bookmark' })) {
      return;
    }

    addToLibrary.mutate(book.id, {
      onSuccess: async () => {
        toast.success(t(locale, 'content.bookDetail.addedToLibraryToast'));
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: bookDetailQueryKey.detail(book.id) }),
          queryClient.invalidateQueries({ queryKey: recommendationsQueryKey.all }),
        ]);
      },
      onError: (error) => {
        if (isUnauthorizedError(error)) {
          openLogin({ reason: 'bookmark' });
          return;
        }
        toast.error(formatApiError(error));
      },
    });
  }

  return (
    <div
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
        'flex w-full flex-col gap-8 md:gap-14 md:pb-8',
        book.isReadable ? 'pb-36' : 'pb-8',
      )}
    >
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Link
          href={returnTo}
          replace
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-200 ease-out-soft hover:text-primary"
        >
          <ArrowLeftIcon className="size-4" strokeWidth={1.5} aria-hidden />
          {returnLabel}
        </Link>
        {book.libraryItem ? (
          <LibraryWorkManagement
            entry={book.libraryItem}
            tags={userTags.data ?? []}
            locale={locale}
            onRemoved={() => router.replace(AUTH_ROUTES.library)}
          />
        ) : null}
      </div>

      <BookDetailHero
        book={book}
        inLibrary={isInLibrary}
        onAddToLibrary={handleAddToLibrary}
        isAddingToLibrary={addToLibrary.isPending}
      />
      <BookDetailMobileProgress book={book} />

      <div className="flex flex-col gap-8 md:gap-14">
        <BookDetailStats book={book} />
        {book.isReadable && book.chapters.length > 0 ? <BookDetailToc book={book} /> : null}
        {book.libraryItem?.libraryItemKind === 'personal' ? null : (
          <BookDetailRecommendations excludeWorkId={book.id} />
        )}
      </div>

      <BookDetailStickyCta
        book={book}
        inLibrary={isInLibrary}
        onAddToLibrary={handleAddToLibrary}
        isAddingToLibrary={addToLibrary.isPending}
      />
    </div>
  );
}

/**
 * Work detail for public Catalog and owner-visible Personal ReadingWorks.
 */
export function BookDetailPage({ workId, returnTo }: { workId: string; returnTo: string }) {
  const detailQuery = useBookDetailQuery(workId);

  if (detailQuery.isPending) {
    return <BookDetailSkeleton />;
  }

  if (detailQuery.isError) {
    return (
      <BookDetailUnavailable
        workId={workId}
        message={formatBookDetailApiError(detailQuery.error)}
        returnTo={returnTo}
      />
    );
  }

  return <BookDetailView book={detailQuery.data.book} returnTo={returnTo} />;
}
