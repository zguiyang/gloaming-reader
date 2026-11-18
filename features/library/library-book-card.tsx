'use client';

import { AlertCircleIcon, LoaderCircleIcon } from 'lucide-react';
import Link from 'next/link';

import { t } from '@/i18n';
import type { LibraryItem, UserTagManagementItem } from '@/shared/library';

import { AUTH_ROUTES } from '@/constants';
import { LibraryWorkManagement } from '@/features/library/library-work-management';
import { WorkCover } from '@/features/work-cover';
import { coverUrlFromAssetId } from '@/lib/asset-url';
import { useLocale } from '@/lib/locale-context';
import { workDetailHref } from '@/lib/navigation/work-detail-return';
import { cn } from '@/lib/utils';

export function LibraryBookCard({
  entry,
  tags,
  returnTo = AUTH_ROUTES.library,
  view = 'grid',
}: {
  entry: LibraryItem;
  tags: UserTagManagementItem[];
  returnTo?: string;
  view?: 'grid' | 'list';
}) {
  const { locale } = useLocale();
  const { work, state } = entry;
  const readHref = AUTH_ROUTES.readBook(work.id, state?.currentPartId ?? undefined);
  const detailHref = workDetailHref(work.id, returnTo);
  const isProcessing = entry.availability === 'processing';
  const isFailed = entry.availability === 'failed';
  const isReady = entry.availability === 'ready';
  // Cover/title open the reader when ready; detail lives in the ··· menu.
  const primaryHref = isReady ? readHref : detailHref;
  const primaryAria = isReady
    ? t(locale, 'content.common.openReaderAria', { title: work.title })
    : t(locale, 'content.common.viewBookDetailAria', { title: work.title });
  const status = isProcessing
    ? t(locale, 'content.library.processing')
    : isFailed
      ? t(locale, 'content.library.importFailed')
      : state?.status === 'completed'
        ? t(locale, 'content.library.statusCompleted')
        : state?.status === 'in_progress'
          ? state.progressRatio > 0
            ? t(locale, 'content.library.statusReadProgress', { ratio: state.progressRatio })
            : t(locale, 'content.library.readingInProgress')
          : t(locale, 'content.library.statusNotStarted');

  if (view === 'list') {
    return (
      <article className="group flex min-w-0 items-start gap-4 border-b border-border/50 py-4">
        <Link
          href={primaryHref}
          className="relative block w-20 shrink-0 outline-none transition-opacity duration-200 ease-out-soft hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-24"
          aria-label={primaryAria}
        >
          <WorkCover
            title={work.title}
            coverImageUrl={coverUrlFromAssetId(work.coverAssetId)}
            className="aspect-[2/3] rounded-sm"
          />
          {isProcessing || isFailed ? (
            <span
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-sm bg-black/65 px-2 text-center text-sm font-medium text-white"
              role={isProcessing ? 'status' : undefined}
            >
              {isProcessing ? (
                <LoaderCircleIcon className="size-6 motion-safe:animate-spin" aria-hidden />
              ) : (
                <AlertCircleIcon className="size-6" aria-hidden />
              )}
              {t(locale, isProcessing ? 'content.library.processing' : 'content.library.importFailed')}
            </span>
          ) : null}
        </Link>
        <div className="min-w-0 w-full">
          <div className="flex min-w-0 items-start gap-0.5">
            <Link
              href={primaryHref}
              className="min-w-0 flex-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <h3
                className="font-heading line-clamp-2 text-sm leading-snug font-medium text-foreground transition-colors group-hover:text-primary md:text-base"
                title={work.title}
              >
                {work.title}
              </h3>
            </Link>
            <LibraryWorkManagement entry={entry} tags={tags} locale={locale} detailHref={detailHref} />
          </div>
          {isReady || isProcessing || isFailed ? (
            <p className={cn('mt-1.5 text-xs leading-snug', isFailed ? 'text-destructive' : 'text-muted-foreground')}>
              {status}
            </p>
          ) : null}
        </div>
      </article>
    );
  }

  // Grid: cover-forward bookshelf cell. Title reserves two lines so status rows align.
  return (
    <article className="group flex min-w-0 flex-col gap-2">
      <Link
        href={primaryHref}
        className="relative block outline-none transition-opacity duration-200 ease-out-soft hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={primaryAria}
      >
        <WorkCover
          title={work.title}
          coverImageUrl={coverUrlFromAssetId(work.coverAssetId)}
          className="aspect-[2/3] rounded-sm"
        />
        {isProcessing || isFailed ? (
          <span
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-sm bg-black/65 px-2 text-center text-xs font-medium text-white sm:text-sm"
            role={isProcessing ? 'status' : undefined}
          >
            {isProcessing ? (
              <LoaderCircleIcon className="size-5 motion-safe:animate-spin sm:size-6" aria-hidden />
            ) : (
              <AlertCircleIcon className="size-5 sm:size-6" aria-hidden />
            )}
            {t(locale, isProcessing ? 'content.library.processing' : 'content.library.importFailed')}
          </span>
        ) : null}
      </Link>

      <div className="flex min-w-0 flex-col gap-1">
        <Link href={primaryHref} className="block outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <h3
            className="font-heading line-clamp-2 h-[2.625rem] text-sm leading-[1.3125rem] font-medium text-foreground transition-colors group-hover:text-primary"
            title={work.title}
          >
            {work.title}
          </h3>
        </Link>

        <div className="flex min-w-0 items-center gap-0.5">
          <p
            className={cn(
              'min-w-0 flex-1 truncate text-xs leading-snug',
              isFailed ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {isReady || isProcessing || isFailed ? status : null}
          </p>
          <LibraryWorkManagement entry={entry} tags={tags} locale={locale} detailHref={detailHref} />
        </div>
      </div>
    </article>
  );
}
