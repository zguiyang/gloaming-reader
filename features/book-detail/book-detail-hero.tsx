'use client';

import { BookOpenIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

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

type BookDetailHeroProps = {
  book: BookDetail;
};

function BookDescription({ description }: { description: string | null }) {
  const { locale } = useLocale();
  const [isExpanded, setIsExpanded] = useState(false);
  const text = description?.trim() ?? '';
  const isLong = text.length > 400;
  if (!text) return null;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 text-left md:mx-0">
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
    </div>
  );
}

export function BookDetailHero({ book }: BookDetailHeroProps) {
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

      <BookDescription description={book.teaser} />

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

export function BookDetailStickyCta({ book }: { book: BookDetail }) {
  const { locale } = useLocale();
  const currentPartId = book.chapters.find((chapter) => chapter.status === 'current')?.id;
  const readHref = AUTH_ROUTES.readBook(book.id, currentPartId);
  const readLabel = primaryReadLabel(book.readingStatus, locale);

  if (!book.isReadable) return null;

  return (
    <div className="fixed inset-x-0 z-40 border-t border-border/60 bg-background/95 p-4 backdrop-blur-md md:hidden bottom-[var(--app-shell-bottom,0px)]">
      <div className="mx-auto flex max-w-lg">
        <Link
          href={readHref}
          className={buttonVariants({
            className: 'h-12 w-full rounded-xl text-base shadow-sm hover:bg-brand-deep active:scale-[0.98]',
          })}
        >
          <BookOpenIcon className="size-4" strokeWidth={1.5} aria-hidden />
          {readLabel}
        </Link>
      </div>
    </div>
  );
}
