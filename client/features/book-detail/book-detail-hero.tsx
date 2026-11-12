'use client';

import { BookmarkIcon, BookOpenIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, Loader2Icon } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';

import { t } from '@/i18n';

import { Button, buttonVariants } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { WorkDetailHeroLayout } from '@/components/work-detail-hero-layout';
import { AUTH_ROUTES } from '@/constants';
import {
  type BookDetail,
  formatMinutes,
  formatRelativeReadTime,
  primaryReadLabel,
} from '@/features/book-detail/book-detail-model';
import { WorkCover } from '@/features/work-cover';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type BookDetailHeroProps = {
  book: BookDetail;
  inLibrary: boolean;
  onAddToLibrary: () => void;
  isAddingToLibrary?: boolean;
};

function BookDescription({ description, notes }: { description: string | null; notes?: string[] }) {
  const { locale } = useLocale();
  const [isExpanded, setIsExpanded] = useState(false);
  const text = description?.trim() ?? '';
  const isLong = text.length > 400;
  if (!text && !notes?.length) return null;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 text-left md:mx-0">
      {text ? (
        <p className="font-reading whitespace-pre-line break-words text-base leading-7 text-muted-foreground">
          {isLong && !isExpanded ? `${text.slice(0, 400).trimEnd()}…` : text}
          {isLong ? (
            <Button
              variant="plain"
              size={null}
              type="button"
              className="ml-1 inline-flex size-8 items-center justify-center rounded text-primary align-middle hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t(
                locale,
                isExpanded ? 'content.bookDetail.descriptionCollapse' : 'content.bookDetail.descriptionExpand',
              )}
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded((value) => !value)}
            >
              {isExpanded ? (
                <ChevronUpIcon className="size-4" aria-hidden />
              ) : (
                <ChevronDownIcon className="size-4" aria-hidden />
              )}
            </Button>
          ) : null}
        </p>
      ) : null}
      {notes?.length ? (
        <section className="space-y-2">
          <h2 className="font-heading text-base font-semibold">{t(locale, 'content.bookDetail.sourceNotes')}</h2>
          {notes.map((note, index) => (
            <p key={index} className="whitespace-pre-line break-words text-sm leading-6 text-muted-foreground">
              {note}
            </p>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function BookDetailHero({ book, inLibrary, onAddToLibrary, isAddingToLibrary }: BookDetailHeroProps) {
  const { locale } = useLocale();
  const currentPartId = book.chapters.find((chapter) => chapter.status === 'current')?.id;
  const readHref = AUTH_ROUTES.readBook(book.id, currentPartId);
  const readLabel = primaryReadLabel(book.readingStatus, locale);
  const lastRead = formatRelativeReadTime(book.lastReadAt, new Date(), locale);
  const isCompleted = book.readingStatus === 'completed';
  const hasProgress =
    isCompleted || (book.readingStatus === 'in_progress' && book.progressRatio != null && book.progressRatio > 0);
  const progressPercent = isCompleted ? 100 : (book.progressRatio ?? 0);
  const progressLabel = isCompleted
    ? t(locale, 'content.bookDetail.progressCompleted')
    : t(locale, 'content.bookDetail.progressRead', { ratio: book.progressRatio ?? 0 });

  return (
    <WorkDetailHeroLayout
      cover={
        <WorkCover
          title={book.title}
          coverImageUrl={book.coverImageUrl}
          className="aspect-[2/3] w-48 md:w-full md:max-w-[280px]"
        />
      }
    >
      <div className="space-y-2">
        {book.availability === 'processing' || book.availability === 'failed' ? (
          <div className="mb-2 flex flex-wrap items-center justify-center gap-2 md:justify-start">
            {book.availability === 'processing' ? (
              <span role="status" className="text-sm text-muted-foreground">
                {t(locale, 'content.library.processing')}
              </span>
            ) : null}
            {book.availability === 'failed' ? (
              <span className="text-sm text-destructive">{t(locale, 'content.library.importFailed')}</span>
            ) : null}
          </div>
        ) : null}
        <h1 className="font-heading text-3xl leading-tight font-bold tracking-tight text-foreground text-balance md:text-5xl md:leading-[1.15]">
          {book.title}
        </h1>
        {book.author ? (
          <p className="font-heading text-lg text-muted-foreground italic md:text-2xl md:leading-8">{book.author}</p>
        ) : null}
      </div>

      <BookDescription description={book.teaser} notes={book.sourceNotes} />

      <div className="hidden max-w-xl flex-col gap-4 pt-1 md:flex">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {book.isReadable ? (
            <Link
              href={readHref}
              className={buttonVariants({
                className: 'h-11 flex-1 rounded-xl px-8 text-base shadow-sm hover:bg-brand-deep active:scale-[0.98]',
              })}
            >
              <BookOpenIcon className="size-4" strokeWidth={1.5} aria-hidden />
              {readLabel}
            </Link>
          ) : null}
          <LibraryButton
            inLibrary={inLibrary}
            onAdd={onAddToLibrary}
            isAdding={isAddingToLibrary}
            className="h-11 flex-1 rounded-xl px-8 text-base"
          />
        </div>

        {hasProgress ? (
          <div className="w-full">
            <div className="mb-2 flex justify-between text-sm text-muted-foreground">
              <span className="font-medium text-primary">{progressLabel}</span>
              {lastRead ? <span>{t(locale, 'content.bookDetail.lastReadPrefix', { time: lastRead })}</span> : null}
            </div>
            <Progress
              aria-hidden
              value={progressPercent}
              className="h-1.5 rounded-full bg-surface-container-highest"
              indicatorClassName="rounded-full duration-700 ease-out-soft"
            />
          </div>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground md:hidden">
        {[formatMinutes(book.estimatedMinutes, locale)].filter(Boolean).join(' · ')}
      </p>
    </WorkDetailHeroLayout>
  );
}

/** Source records have no readable Work yet, but share the same detail hero. */
export function BookDetailSourceHero({
  title,
  author,
  coverImageUrl,
  description,
  notes,
  categories,
  actions,
}: {
  title: string;
  author: string;
  coverImageUrl: string | null;
  description: string | null;
  notes?: string[];
  categories?: string[];
  actions: ReactNode;
}) {
  return (
    <WorkDetailHeroLayout
      cover={
        <WorkCover
          title={title}
          coverImageUrl={coverImageUrl}
          className="aspect-[2/3] w-48 md:w-full md:max-w-[280px]"
        />
      }
    >
      <div className="space-y-2">
        <h1 className="font-heading text-3xl leading-tight font-bold tracking-tight text-foreground text-balance md:text-5xl md:leading-[1.15]">
          {title}
        </h1>
        {author ? (
          <p className="font-heading text-lg text-muted-foreground italic md:text-2xl md:leading-8">{author}</p>
        ) : null}
      </div>
      <BookDescription description={description} notes={notes} />
      {categories?.length ? (
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <span key={category} className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
              {category}
            </span>
          ))}
        </div>
      ) : null}
      <div className="fixed inset-x-0 z-40 border-t border-border/60 bg-background/95 p-4 backdrop-blur-md bottom-[var(--app-shell-bottom,0px)] md:static md:max-w-xl md:border-0 md:bg-transparent md:p-0 md:pt-1 md:backdrop-blur-none">
        {actions}
      </div>
    </WorkDetailHeroLayout>
  );
}

export function BookDetailMobileProgress({ book }: { book: BookDetail }) {
  const { locale } = useLocale();

  if (book.readingStatus === 'unread') {
    return null;
  }

  const lastRead = formatRelativeReadTime(book.lastReadAt, new Date(), locale);
  const isCompleted = book.readingStatus === 'completed';
  const ratio = isCompleted ? 100 : (book.progressRatio ?? 0);

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-surface-container-highest p-4 md:hidden">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {t(locale, 'content.bookDetail.readingProgress')}
          </p>
          <p className="font-heading text-2xl font-semibold text-primary">
            {isCompleted ? t(locale, 'content.bookDetail.progressCompleted') : `${ratio}%`}
          </p>
        </div>
        {lastRead ? (
          <span className="text-sm text-muted-foreground">
            {t(locale, 'content.bookDetail.lastReadPrefix', { time: lastRead })}
          </span>
        ) : null}
      </div>
      <Progress
        aria-hidden
        value={ratio}
        className="h-2 rounded-full bg-muted"
        indicatorClassName="rounded-full duration-700 ease-out-soft"
      />
    </section>
  );
}

export function BookDetailStickyCta({
  book,
  inLibrary,
  onAddToLibrary,
  isAddingToLibrary,
}: {
  book: BookDetail;
  inLibrary: boolean;
  onAddToLibrary: () => void;
  isAddingToLibrary?: boolean;
}) {
  const { locale } = useLocale();
  const currentPartId = book.chapters.find((chapter) => chapter.status === 'current')?.id;
  const readHref = AUTH_ROUTES.readBook(book.id, currentPartId);
  const readLabel = primaryReadLabel(book.readingStatus, locale);

  if (!book.isReadable) return null;

  return (
    <div className="fixed inset-x-0 z-40 border-t border-border/60 bg-background/95 p-4 backdrop-blur-md md:hidden bottom-[var(--app-shell-bottom,0px)]">
      <div className="mx-auto flex max-w-lg gap-3">
        <Link
          href={readHref}
          className={buttonVariants({
            className: 'h-12 flex-1 rounded-xl text-base shadow-sm hover:bg-brand-deep active:scale-[0.98]',
          })}
        >
          <BookOpenIcon className="size-4" strokeWidth={1.5} aria-hidden />
          {readLabel}
        </Link>
        {!inLibrary ? (
          <Button
            type="button"
            variant="outline"
            className="h-12 shrink-0 rounded-xl px-4"
            disabled={isAddingToLibrary}
            onClick={() => {
              onAddToLibrary();
            }}
            aria-label={t(locale, 'content.bookDetail.addToLibraryAria')}
          >
            {isAddingToLibrary ? (
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

function LibraryButton({
  inLibrary,
  onAdd,
  isAdding,
  className,
}: {
  inLibrary: boolean;
  onAdd: () => void;
  isAdding?: boolean;
  className?: string;
}) {
  const { locale } = useLocale();

  if (inLibrary) {
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
        {t(locale, 'content.bookDetail.inLibrary')}
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
      {t(locale, 'content.bookDetail.addToLibrary')}
    </Button>
  );
}
