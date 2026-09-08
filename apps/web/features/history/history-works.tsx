'use client';

import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';

import { AUTH_ROUTES } from '@/constants';
import { coverTintForVolume } from '@/features/content/content-model';
import { formatHistoryCalendarDate, type HistoryViewModel } from '@/features/history/history-model';
import { coverUrlFromAssetId } from '@/lib/asset-url';
import { cn } from '@/lib/utils';

function WorkCover({ title, coverImageUrl }: { title: string; coverImageUrl: string | null }) {
  const tint = coverTintForVolume([], title);

  return (
    <div
      className={cn(
        'relative h-20 w-14 shrink-0 overflow-hidden rounded-sm shadow-sm ring-1 ring-foreground/8 md:h-24 md:w-16',
        !coverImageUrl && tint,
      )}
    >
      {coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- cover assets via API proxy
        <img src={coverImageUrl} alt="" className="size-full object-cover" />
      ) : (
        <p className="font-heading line-clamp-4 p-1.5 text-[10px] font-semibold leading-tight text-foreground/80 md:p-2 md:text-xs">
          {title}
        </p>
      )}
    </div>
  );
}

export function HistoryWorks({ works }: { works: HistoryViewModel['works'] }) {
  if (works.length === 0) {
    return null;
  }

  const sorted = [...works].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  return (
    <section className="w-full space-y-4 md:space-y-6">
      <h2 className="font-heading text-xl font-semibold text-foreground md:text-2xl">读过的作品</h2>
      <ul>
        {sorted.map((item) => {
          const coverImageUrl = coverUrlFromAssetId(item.coverAssetId);
          const dateLabel = formatHistoryCalendarDate(item.date);
          const statusLabel = item.status === 'completed' ? '已读完' : '正在阅读';

          return (
            <li
              key={`${item.workId}-${item.status}-${item.date}`}
              className="border-b border-border/50 last:border-b-0"
            >
              <Link
                href={AUTH_ROUTES.readBook(item.workId)}
                className="group flex items-center gap-4 py-4 transition-colors md:gap-6 md:py-6"
              >
                <WorkCover title={item.title} coverImageUrl={coverImageUrl} />

                <div className="min-w-0 flex-1">
                  <h3 className="font-heading truncate text-base font-medium text-foreground transition-colors group-hover:text-primary md:text-xl">
                    {item.title}
                  </h3>
                  {item.author ? <p className="mt-0.5 truncate text-sm text-muted-foreground">{item.author}</p> : null}
                  <p className="mt-1 text-sm text-muted-foreground md:hidden">
                    {item.status === 'completed' ? `已读完于 ${dateLabel}` : `最近阅读于 ${dateLabel}`}
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
