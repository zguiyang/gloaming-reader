'use client';

import { AlertCircleIcon, BookOpenIcon, LoaderCircleIcon } from 'lucide-react';
import Link from 'next/link';

import { t } from '@gloaming/i18n';
import type { LibraryItem, UserTagManagementItem } from '@gloaming/shared/library';

import { Button } from '@/components/ui/button';
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
  const status =
    state?.status === 'completed'
      ? t(locale, 'content.library.statusCompleted')
      : state?.status === 'in_progress'
        ? state.progressRatio > 0
          ? t(locale, 'content.library.statusReadProgress', { ratio: state.progressRatio })
          : t(locale, 'content.library.readingInProgress')
        : t(locale, 'content.library.statusNotStarted');

  return (
    <article
      className={cn(
        'group flex min-w-0 gap-2',
        view === 'grid' ? 'flex-col' : 'items-start gap-4 border-b border-border/50 py-4',
      )}
    >
      <Link
        href={detailHref}
        className={cn(
          'relative block outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          view === 'list' && 'w-20 shrink-0 sm:w-24',
        )}
        aria-label={t(locale, 'content.common.viewBookDetailAria', { title: work.title })}
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
        <div className="flex min-w-0 items-start gap-1">
          <Link
            href={detailHref}
            className="min-w-0 flex-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <h3
              className="font-heading line-clamp-2 text-sm leading-snug font-medium text-foreground transition-colors group-hover:text-primary md:text-base"
              title={work.title}
            >
              {work.title}
            </h3>
          </Link>
          <LibraryWorkManagement entry={entry} tags={tags} locale={locale} />
        </div>
        {entry.availability === 'ready' ? (
          <div className="-mt-1">
            <p className="text-xs text-muted-foreground">{status}</p>
            <Button
              nativeButton={false}
              variant="link"
              className="mt-1 h-auto min-h-9 px-0 text-sm"
              render={
                <Link href={readHref} aria-label={t(locale, 'content.common.openReaderAria', { title: work.title })} />
              }
            >
              <BookOpenIcon className="size-4" aria-hidden />
              {t(
                locale,
                state?.status === 'completed'
                  ? 'content.bookDetail.readAgain'
                  : state?.status === 'in_progress'
                    ? 'content.bookDetail.readContinue'
                    : 'content.bookDetail.readStart',
              )}
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
