'use client';

import Link from 'next/link';

import { AUTH_ROUTES } from '@/constants';
import type { DiscoverItem } from '@/features/discover/discover-model';
import { WorkCover } from '@/features/work-cover';
import { cn } from '@/lib/utils';

type DiscoverBookCardProps = {
  item: DiscoverItem;
};

function chapterCountLabel(count: number): string {
  return `${count} 章`;
}

export function DiscoverBookCard({ item }: DiscoverBookCardProps) {
  const detailHref = AUTH_ROUTES.bookDetail(item.id);
  const progress =
    item.shelfStatus === 'in_progress' && item.progressRatio != null && item.progressRatio > 0
      ? item.progressRatio
      : null;

  return (
    <article className="group flex flex-col gap-3">
      <Link
        href={detailHref}
        className={cn(
          'relative outline-none',
          'transition-transform duration-300 ease-out-soft',
          'hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50',
        )}
        aria-label={`查看《${item.title}》详情`}
      >
        <WorkCover
          title={item.title}
          tags={item.tags}
          coverImageUrl={item.coverImageUrl}
          className="aspect-[2/3] rounded-sm"
        />
        {progress != null ? (
          <div className="absolute inset-x-0 bottom-0 z-10 h-0.5 bg-muted/80">
            <div
              className="h-full bg-primary transition-[width] duration-500 ease-out-soft"
              style={{ width: `${progress}%` }}
            />
          </div>
        ) : null}
      </Link>

      <div className="min-w-0">
        <Link href={detailHref} className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <h3
            className="font-heading line-clamp-2 text-sm leading-snug font-medium text-foreground transition-colors duration-300 ease-out-soft group-hover:text-primary md:text-base"
            title={item.title}
          >
            {item.title}
          </h3>
        </Link>
        {item.author ? (
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground md:text-[13px]">{item.author}</p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground/80">{chapterCountLabel(item.partCount)}</p>
      </div>
    </article>
  );
}
