'use client';

import { BookOpenIcon } from 'lucide-react';
import Link from 'next/link';

import { type Locale, t } from '@/i18n';
import type { ContinueReadingItem } from '@/shared/library';

import { buttonVariants } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AUTH_ROUTES } from '@/constants';
import { WorkCover } from '@/features/work-cover';
import { coverUrlFromAssetId } from '@/lib/asset-url';
import { useLocale } from '@/lib/locale-context';

function progressLabel(ratio: number, locale: Locale): string {
  return t(locale, 'content.library.progressRead', { ratio });
}

/** Compact Continue Reading shortcut; independent of the active source/tag filters. */
export function LibraryContinueHero({ entry }: { entry: ContinueReadingItem }) {
  const { locale } = useLocale();
  const ratio = entry.state.progressRatio;
  const readHref = AUTH_ROUTES.readBook(entry.work.id, entry.state.currentPartId ?? undefined);
  const coverImageUrl = coverUrlFromAssetId(entry.work.coverAssetId);

  return (
    <section className="w-full max-w-2xl" aria-labelledby="library-continue-reading-heading">
      <h2
        id="library-continue-reading-heading"
        className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {t(locale, 'content.library.continueReading')}
      </h2>
      <div className="flex items-center gap-3 md:gap-4">
        <Link
          href={readHref}
          className="shrink-0 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={t(locale, 'content.common.openReaderAria', { title: entry.work.title })}
        >
          <WorkCover
            title={entry.work.title}
            coverImageUrl={coverImageUrl}
            className="aspect-[2/3] w-12 rounded-sm md:w-14"
          />
        </Link>

        <div className="min-w-0 flex-1">
          <Link href={readHref} className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <h2 className="font-heading line-clamp-1 text-sm leading-snug font-semibold text-foreground transition-colors duration-300 ease-out-soft hover:text-primary md:text-base">
              {entry.work.title}
            </h2>
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(locale, 'content.library.readingInProgress')}
            {ratio > 0 ? (
              <>
                <span className="mx-1.5 text-border" aria-hidden>
                  ·
                </span>
                {progressLabel(ratio, locale)}
              </>
            ) : null}
          </p>
          {ratio > 0 ? (
            <Progress
              aria-hidden
              value={Math.min(100, ratio)}
              className="mt-1.5 h-0.5 max-w-xs rounded-full bg-muted/80"
              indicatorClassName="rounded-full duration-700 ease-out-soft"
            />
          ) : null}
          <Link
            href={readHref}
            aria-label={t(locale, 'content.common.openReaderAria', { title: entry.work.title })}
            className={buttonVariants({
              variant: 'ghost',
              className:
                '-ml-2 mt-1 h-8 rounded-lg px-2 text-sm font-medium text-primary hover:bg-muted active:scale-[0.98]',
            })}
          >
            <BookOpenIcon className="size-4" strokeWidth={1.5} aria-hidden />
            {t(locale, 'content.library.continueReading')}
          </Link>
        </div>
      </div>
    </section>
  );
}
