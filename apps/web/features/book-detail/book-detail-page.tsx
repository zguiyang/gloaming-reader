'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import { AUTH_ROUTES } from '@/constants';
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
import { useAddToShelfMutation } from '@/features/reading-state/reading-state-client';
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

function BookDetailView({ book }: { book: BookDetail }) {
  const queryClient = useQueryClient();
  const addToShelf = useAddToShelfMutation();
  const isOnShelf = book.shelfStatus === 'on_shelf';

  function handleAddToShelf() {
    addToShelf.mutate(book.id, {
      onSuccess: async () => {
        toast.success('已加入书架');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: bookDetailQueryKey.detail(book.id) }),
          queryClient.invalidateQueries({ queryKey: recommendationsQueryKey.all }),
        ]);
      },
      onError: (error) => toast.error(formatBookDetailApiError(error)),
    });
  }

  return (
    <div
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
        'flex w-full flex-col gap-8 pb-36 md:gap-14 md:pb-8',
      )}
    >
      <div className="md:hidden">
        <Link
          href={AUTH_ROUTES.discover}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-200 ease-out-soft hover:text-primary"
        >
          <ArrowLeftIcon className="size-4" strokeWidth={1.5} aria-hidden />
          返回发现
        </Link>
      </div>

      <BookDetailHero
        book={book}
        onShelf={isOnShelf}
        onAddToShelf={handleAddToShelf}
        isAddingToShelf={addToShelf.isPending}
      />
      <BookDetailMobileProgress book={book} />

      <div className="flex flex-col gap-8 md:gap-14">
        <BookDetailStats book={book} />
        <BookDetailToc book={book} />
        <BookDetailRecommendations excludeWorkId={book.id} />
      </div>

      <footer className="border-t border-border/50 pt-8 text-center text-sm text-muted-foreground">
        <p className="mb-1">Gloaming — The Quiet Art of Slow Reading.</p>
      </footer>

      <BookDetailStickyCta
        book={book}
        onShelf={isOnShelf}
        onAddToShelf={handleAddToShelf}
        isAddingToShelf={addToShelf.isPending}
      />
    </div>
  );
}

/**
 * Book detail for published work UUIDs — catalog / shelf / parts hybrid.
 */
export function BookDetailPage({ workId }: { workId: string }) {
  const detailQuery = useBookDetailQuery(workId);

  if (detailQuery.isPending) {
    return <BookDetailSkeleton />;
  }

  if (detailQuery.isError) {
    return <BookDetailUnavailable workId={workId} message={formatBookDetailApiError(detailQuery.error)} />;
  }

  return <BookDetailView book={detailQuery.data.book} />;
}
