'use client';

import { BookmarkIcon, BookOpenIcon, CheckIcon, LanguagesIcon, Loader2Icon } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { AUTH_ROUTES } from '@/constants';
import {
  type BookDetail,
  formatMinutes,
  formatRelativeReadTime,
  primaryReadLabel,
} from '@/features/book-detail/book-detail-model';
import { WorkCover } from '@/features/work-cover';
import { cn } from '@/lib/utils';

type BookDetailHeroProps = {
  book: BookDetail;
  onShelf: boolean;
  onAddToShelf: () => void;
  isAddingToShelf?: boolean;
};

export function BookDetailHero({ book, onShelf, onAddToShelf, isAddingToShelf }: BookDetailHeroProps) {
  const readHref = AUTH_ROUTES.readBook(book.id);
  const readLabel = primaryReadLabel(book.readingStatus);
  const lastRead = formatRelativeReadTime(book.lastReadAt);
  const isCompleted = book.readingStatus === 'completed';
  const hasProgress =
    isCompleted || (book.readingStatus === 'in_progress' && book.progressRatio != null && book.progressRatio > 0);
  const progressPercent = isCompleted ? 100 : (book.progressRatio ?? 0);
  const progressLabel = isCompleted ? '已读完' : `已阅读 ${book.progressRatio}%`;
  const chips = book.tags.slice(0, 3);

  return (
    <section className="grid grid-cols-1 items-center gap-8 md:grid-cols-12 md:gap-12 lg:gap-16">
      <div className="flex justify-center md:col-span-4 md:justify-start lg:col-span-3">
        <WorkCover
          title={book.title}
          tags={book.tags}
          coverImageUrl={book.coverImageUrl}
          className="aspect-[2/3] w-48 md:w-full md:max-w-[280px]"
        />
      </div>

      <div className="space-y-5 text-center md:col-span-8 md:space-y-6 md:text-left lg:col-span-9">
        <div className="space-y-2">
          <div className="mb-2 flex flex-wrap items-center justify-center gap-2 md:justify-start">
            <span className="rounded bg-primary/10 px-2 py-1 text-[11px] font-semibold tracking-[0.08em] text-primary uppercase">
              {book.sourceLabel}
            </span>
            {book.languageLabel ? (
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <LanguagesIcon className="size-3.5" strokeWidth={1.5} aria-hidden />
                {book.languageLabel}
              </span>
            ) : null}
          </div>
          <h1 className="font-heading text-3xl leading-tight font-bold tracking-tight text-foreground text-balance md:text-5xl md:leading-[1.15]">
            {book.title}
          </h1>
          {book.author ? (
            <p className="font-heading text-lg text-muted-foreground italic md:text-2xl md:leading-8">{book.author}</p>
          ) : null}
        </div>

        {chips.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-2 md:justify-start">
            {chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-border/40 bg-surface-container-highest/80 px-3.5 py-1.5 text-sm text-muted-foreground"
              >
                {chip}
              </span>
            ))}
          </div>
        ) : null}

        {book.teaser ? (
          <p className="font-reading mx-auto max-w-2xl text-base leading-7 text-muted-foreground md:mx-0 md:text-lg md:leading-8 md:italic">
            {book.teaser}
          </p>
        ) : null}

        <div className="hidden max-w-xl flex-col gap-4 pt-1 md:flex">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Button
              nativeButton={false}
              className="h-11 flex-1 rounded-xl px-8 text-base shadow-sm hover:bg-brand-deep active:scale-[0.98]"
              render={<Link href={readHref} />}
            >
              <BookOpenIcon className="size-4" strokeWidth={1.5} aria-hidden />
              {readLabel}
            </Button>
            <ShelfButton
              onShelf={onShelf}
              onAdd={onAddToShelf}
              isAdding={isAddingToShelf}
              className="h-11 flex-1 rounded-xl px-8 text-base"
            />
          </div>

          {hasProgress ? (
            <div className="w-full">
              <div className="mb-2 flex justify-between text-sm text-muted-foreground">
                <span className="font-medium text-primary">{progressLabel}</span>
                {lastRead ? <span>上次阅读：{lastRead}</span> : null}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out-soft"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>

        <p className="text-sm text-muted-foreground md:hidden">
          {[formatMinutes(book.estimatedMinutes), book.category].filter(Boolean).join(' · ')}
        </p>
      </div>
    </section>
  );
}

export function BookDetailMobileProgress({ book }: { book: BookDetail }) {
  if (book.readingStatus === 'unread') {
    return null;
  }

  const lastRead = formatRelativeReadTime(book.lastReadAt);
  const isCompleted = book.readingStatus === 'completed';
  const ratio = isCompleted ? 100 : (book.progressRatio ?? 0);

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-surface-container-highest p-4 md:hidden">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">阅读进度</p>
          <p className="font-heading text-2xl font-semibold text-primary">{isCompleted ? '已读完' : `${ratio}%`}</p>
        </div>
        {lastRead ? <span className="text-sm text-muted-foreground">上次阅读：{lastRead}</span> : null}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out-soft"
          style={{ width: `${ratio}%` }}
        />
      </div>
    </section>
  );
}

export function BookDetailStickyCta({
  book,
  onShelf,
  onAddToShelf,
  isAddingToShelf,
}: {
  book: BookDetail;
  onShelf: boolean;
  onAddToShelf: () => void;
  isAddingToShelf?: boolean;
}) {
  const readHref = AUTH_ROUTES.readBook(book.id);
  const readLabel = primaryReadLabel(book.readingStatus);

  return (
    <div className="fixed inset-x-0 z-40 border-t border-border/60 bg-background/95 p-4 backdrop-blur-md md:hidden bottom-[var(--app-shell-bottom,0px)]">
      <div className="mx-auto flex max-w-lg gap-3">
        <Button
          nativeButton={false}
          className="h-12 flex-1 rounded-xl text-base shadow-sm hover:bg-brand-deep active:scale-[0.98]"
          render={<Link href={readHref} />}
        >
          <BookOpenIcon className="size-4" strokeWidth={1.5} aria-hidden />
          {readLabel}
        </Button>
        {!onShelf ? (
          <Button
            type="button"
            variant="outline"
            className="h-12 shrink-0 rounded-xl px-4"
            disabled={isAddingToShelf}
            onClick={() => {
              onAddToShelf();
            }}
            aria-label="加入书架"
          >
            {isAddingToShelf ? (
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
            ) : (
              <BookmarkIcon className="size-4" strokeWidth={1.5} aria-hidden />
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ShelfButton({
  onShelf,
  onAdd,
  isAdding,
  className,
}: {
  onShelf: boolean;
  onAdd: () => void;
  isAdding?: boolean;
  className?: string;
}) {
  if (onShelf) {
    return (
      <Button
        type="button"
        variant="secondary"
        disabled
        className={cn(
          'cursor-default gap-2 bg-surface-container-high text-muted-foreground shadow-none disabled:opacity-100',
          className,
        )}
      >
        <CheckIcon className="size-4" strokeWidth={1.5} aria-hidden />
        已在书架
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={isAdding}
      className={cn('gap-2 border-outline/50 bg-card shadow-none hover:bg-surface-container-low', className)}
      onClick={() => {
        onAdd();
      }}
    >
      {isAdding ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : null}
      <BookmarkIcon className="size-4" strokeWidth={1.5} aria-hidden />
      加入书架
    </Button>
  );
}
