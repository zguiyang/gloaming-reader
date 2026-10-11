'use client';

import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { AUTH_ROUTES } from '@/constants';
import { formatHistoryCalendarDate, type HistoryViewModel } from '@/features/history/history-model';
import { WorkCover } from '@/features/work-cover';
import { coverUrlFromAssetId } from '@/lib/asset-url';
import { useLocale } from '@/lib/locale-context';
import { workDetailHref } from '@/lib/navigation/work-detail-return';

export function HistoryWorks({ works }: { works: HistoryViewModel['works'] }) {
  const { locale } = useLocale();

  if (works.length === 0) {
    return null;
  }

  const sorted = [...works].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  return (
    <section className="w-full space-y-4 md:space-y-6">
      <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">
        {t(locale, 'content.history.worksRead')}
      </h2>
      <ul>
        {sorted.map((item) => {
          const coverImageUrl = coverUrlFromAssetId(item.coverAssetId);
          const dateLabel = formatHistoryCalendarDate(item.date, locale);
          const statusLabel =
            item.status === 'completed'
              ? t(locale, 'content.history.statusCompleted')
              : t(locale, 'content.history.statusInProgress');

          return (
            <li
              key={`${item.workId}-${item.status}-${item.date}`}
              className="border-b border-border/50 last:border-b-0"
            >
              <div className="flex items-center gap-4 py-4 md:gap-6 md:py-6">
                <Link
                  href={workDetailHref(item.workId, AUTH_ROUTES.history)}
                  className="group flex min-w-0 flex-1 items-center gap-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:gap-6"
                  aria-label={t(locale, 'content.common.viewBookDetailAria', { title: item.title })}
                >
                  <WorkCover appearance="compact" title={item.title} coverImageUrl={coverImageUrl} />

                  <div className="min-w-0 flex-1">
                    <h3 className="font-heading truncate text-base font-medium text-foreground transition-colors group-hover:text-primary md:text-xl">
                      {item.title}
                    </h3>
                    {item.author ? (
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">{item.author}</p>
                    ) : null}
                    <p className="mt-1 text-sm text-muted-foreground md:hidden">
                      {item.status === 'completed'
                        ? t(locale, 'content.history.completedOn', { date: dateLabel })
                        : t(locale, 'content.history.lastReadOn', { date: dateLabel })}
                    </p>
                  </div>

                  <div className="hidden shrink-0 flex-col items-end gap-1 text-right md:flex">
                    <span className="text-xs font-medium tracking-wide text-muted-foreground">{statusLabel}</span>
                    <span className="text-sm text-muted-foreground/90">{dateLabel}</span>
                  </div>

                  <ChevronRightIcon
                    className="size-5 shrink-0 text-muted-foreground/60 md:hidden"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                </Link>
                <Button
                  nativeButton={false}
                  variant="outline"
                  className="min-h-11 shrink-0 px-3 md:px-5"
                  render={<Link href={AUTH_ROUTES.readBook(item.workId)} />}
                >
                  {t(
                    locale,
                    item.status === 'completed' ? 'content.bookDetail.readAgain' : 'content.bookDetail.readContinue',
                  )}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
