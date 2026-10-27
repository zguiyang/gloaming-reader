'use client';

import { BookOpenIcon } from 'lucide-react';
import Link from 'next/link';

import { type Locale, t } from '@gloaming/i18n';
import type { LibraryItem, UserTagManagementItem } from '@gloaming/shared/library';

import { Button } from '@/components/ui/button';
import { AUTH_ROUTES } from '@/constants';
import { libraryTitleContext } from '@/features/library/library-title-context';
import { LibraryWorkManagement } from '@/features/library/library-work-management';
import { WorkCover } from '@/features/work-cover';
import { coverUrlFromAssetId } from '@/lib/asset-url';
import { useLocale } from '@/lib/locale-context';
import { workDetailHref } from '@/lib/navigation/work-detail-return';
import { cn } from '@/lib/utils';

function statusLabel(entry: LibraryItem, locale: Locale): string {
  if (entry.availability === 'processing') {
    return t(locale, 'content.library.processing');
  }
  if (entry.availability === 'failed') {
    return t(locale, 'content.library.importFailed');
  }
  if (!entry.state) {
    return t(locale, 'content.library.statusNotStarted');
  }
  // Reading State owns the visible status; progressRatio is only the separate progress indicator,
  // so any non-completed state reads as in progress, matching History's status semantics.
  return entry.state.status === 'completed'
    ? t(locale, 'content.library.statusCompleted')
    : t(locale, 'content.library.readingInProgress');
}

export function LibraryBookCard({
  entry,
  tags,
  returnTo = AUTH_ROUTES.library,
  showTitleContext = false,
}: {
  entry: LibraryItem;
  tags: UserTagManagementItem[];
  returnTo?: string;
  /** True when another rendered card shares this title; adds trustworthy disambiguators only. */
  showTitleContext?: boolean;
}) {
  const { locale } = useLocale();
  const { work, state } = entry;
  const readHref = AUTH_ROUTES.readBook(work.id, state?.currentPartId ?? undefined);
  const detailHref = workDetailHref(work.id, returnTo);
  const hasProgressBar = entry.availability === 'ready' && state?.status === 'in_progress' && state.progressRatio > 0;
  const coverImageUrl = coverUrlFromAssetId(work.coverAssetId);

  const cover = (
    <WorkCover
      title={work.title}
      coverImageUrl={coverImageUrl}
      className={cn('aspect-[2/3] rounded-sm', entry.availability !== 'ready' && 'grayscale-[0.25]')}
    />
  );

  return (
    <article className="group flex flex-col gap-3">
      <Link
        href={detailHref}
        className="relative block outline-none transition-transform duration-300 ease-out-soft hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={t(locale, 'content.common.viewBookDetailAria', { title: work.title })}
      >
        {cover}
        {entry.availability === 'processing' && !coverImageUrl ? (
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm" aria-hidden>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-background/25 to-transparent motion-safe:animate-[library-cover-sheen_4.5s_ease-in-out_infinite]" />
          </div>
        ) : null}
      </Link>

      <div className="min-w-0">
        <div className="flex items-start gap-1">
          <Link
            href={detailHref}
            className="min-w-0 flex-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <h3
              className="font-heading line-clamp-2 text-sm leading-snug font-medium text-foreground transition-colors duration-300 ease-out-soft group-hover:text-primary md:text-base"
              title={work.title}
            >
              {work.title}
            </h3>
          </Link>
          <LibraryWorkManagement entry={entry} tags={tags} locale={locale} />
        </div>
        {showTitleContext ? (
          // Same-title, different-Work context: origin kind + only the author/published
          // year actually projected for this Work. Never raw IDs or inferred metadata.
          <p className="mt-1 truncate text-xs text-muted-foreground/80">
            {libraryTitleContext(entry, locale).join(' · ')}
          </p>
        ) : null}
        <p
          className={cn(
            'mt-1.5 text-xs',
            entry.availability === 'failed' ? 'text-destructive' : 'text-muted-foreground/90',
          )}
          role={entry.availability === 'processing' ? 'status' : undefined}
        >
          {statusLabel(entry, locale)}
        </p>
        {entry.availability === 'processing' ? (
          <div
            className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-muted/80"
            role="progressbar"
            aria-label={t(locale, 'content.library.processing')}
            aria-valuetext={t(locale, 'content.library.indeterminateProgress')}
          >
            <div className="h-full w-1/3 rounded-full bg-primary/70 motion-safe:animate-[library-indeterminate_2.4s_ease-in-out_infinite]" />
          </div>
        ) : null}
        {entry.availability === 'failed' ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t(locale, 'content.library.failedHint')}
          </p>
        ) : null}
        {entry.availability === 'ready' ? (
          // Stable progress footprint: every ready card reserves this 10px slot (mt-2 + h-0.5) so
          // the read action stays aligned whether or not reading progress exists. The empty spacer
          // carries no progressbar role or status semantics — it reserves layout only.
          <div
            className={cn('mt-2 h-0.5 w-full', hasProgressBar && 'overflow-hidden rounded-full bg-muted/80')}
            role={hasProgressBar ? 'progressbar' : undefined}
            aria-label={
              hasProgressBar
                ? t(locale, 'content.library.statusReadProgress', { ratio: state.progressRatio })
                : undefined
            }
            aria-valuemin={hasProgressBar ? 0 : undefined}
            aria-valuemax={hasProgressBar ? 100 : undefined}
            aria-valuenow={hasProgressBar ? Math.min(100, state.progressRatio) : undefined}
          >
            {hasProgressBar ? (
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out-soft"
                style={{ width: `${Math.min(100, state.progressRatio)}%` }}
              />
            ) : null}
          </div>
        ) : null}
        {entry.availability === 'ready' ? (
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
        ) : null}
      </div>
    </article>
  );
}
