'use client';

import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { t } from '@/i18n';

import { Skeleton } from '@/components/ui/skeleton';
import { AUTH_ROUTES } from '@/constants';
import { formatBookDetailApiError, useBookDetailQuery } from '@/features/book-detail/book-detail-api';
import { BookDetailHero, BookDetailMobileProgress, BookDetailStickyCta } from '@/features/book-detail/book-detail-hero';
import type { BookDetail } from '@/features/book-detail/book-detail-model';
import { BookDetailStats } from '@/features/book-detail/book-detail-stats';
import { BookDetailToc } from '@/features/book-detail/book-detail-toc';
import { BookDetailUnavailable } from '@/features/book-detail/book-detail-unavailable';
import { useUserTagsQuery } from '@/features/library/library-api';
import { LibraryWorkManagement } from '@/features/library/library-work-management';
import { useLocale } from '@/lib/locale-context';
import { workDetailReturnLabelKey } from '@/lib/navigation/work-detail-return';
import { cn } from '@/lib/utils';

function BookDetailSkeleton() {
  return (
    <div className="flex w-full flex-col gap-8 py-8" aria-hidden>
      <Skeleton className="h-8 w-32 rounded bg-surface-container-high" />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
        <Skeleton className="mx-auto aspect-[2/3] w-48 rounded-sm bg-surface-container-high md:col-span-4" />
        <div className="space-y-4 md:col-span-8">
          <Skeleton className="h-10 w-3/4 rounded bg-surface-container-high" />
          <Skeleton className="h-6 w-1/2 rounded bg-surface-container-high" />
        </div>
      </div>
    </div>
  );
}

function BookDetailView({ book, returnTo }: { book: BookDetail; returnTo: string }) {
  const { locale } = useLocale();
  const router = useRouter();
  const userTags = useUserTagsQuery({ enabled: Boolean(book.libraryItem) });

  return (
    <BookDetailPageLayout
      returnTo={returnTo}
      readable={book.isReadable}
      management={
        book.libraryItem ? (
          <LibraryWorkManagement
            entry={book.libraryItem}
            tags={userTags.data ?? []}
            locale={locale}
            onRemoved={() => router.replace(AUTH_ROUTES.library)}
          />
        ) : null
      }
      hero={<BookDetailHero book={book} />}
    >
      <BookDetailMobileProgress book={book} />
      <div className="flex flex-col gap-8 md:gap-14">
        <BookDetailStats book={book} />
        {book.isReadable && book.chapters.length > 0 ? <BookDetailToc book={book} /> : null}
      </div>
      <BookDetailStickyCta book={book} />
    </BookDetailPageLayout>
  );
}

function BookDetailPageLayout({
  returnTo,
  readable,
  management,
  hero,
  children,
}: {
  returnTo: string;
  readable: boolean;
  management?: ReactNode;
  hero: ReactNode;
  children?: ReactNode;
}) {
  const { locale } = useLocale();
  const returnLabel = t(locale, workDetailReturnLabelKey(returnTo));
  return (
    <div
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
        'flex w-full flex-col gap-8 md:gap-14 md:pb-8',
        readable ? 'pb-36' : 'pb-8',
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
        {management}
      </div>

      {hero}
      {children}
    </div>
  );
}

/** Work detail for library ReadingWorks (authenticated, membership required). */
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
