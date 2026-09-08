'use client';

import Link from 'next/link';

import type { ShelfItem } from '@gloaming/shared/shelf';

import { AUTH_ROUTES } from '@/constants';
import { WorkCover } from '@/features/work-cover';
import { coverUrlFromAssetId } from '@/lib/asset-url';
import { cn } from '@/lib/utils';

function statusLabel(entry: ShelfItem): string {
  if (entry.state.status === 'completed') {
    return '已读完';
  }
  if (entry.state.progressRatio <= 0) {
    return '未开始';
  }
  return `已读 ${entry.state.progressRatio}%`;
}

export function ShelfBookCard({ entry }: { entry: ShelfItem }) {
  const { work, state } = entry;
  const detailHref = AUTH_ROUTES.bookDetail(work.id);
  const tagLine = work.tags.slice(0, 2).join(' · ');
  const hasProgressBar = state.status === 'in_progress' && state.progressRatio > 0;
  const coverImageUrl = coverUrlFromAssetId(work.coverAssetId);

  return (
    <article className="group flex flex-col gap-3">
      <Link
        href={detailHref}
        className={cn(
          'outline-none',
          'transition-transform duration-300 ease-out-soft',
          'hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50',
        )}
        aria-label={`查看《${work.title}》详情`}
      >
        <WorkCover
          title={work.title}
          tags={work.tags}
          coverImageUrl={coverImageUrl}
          className="aspect-[2/3] rounded-sm"
        />
      </Link>

      <div className="min-w-0">
        <Link href={detailHref} className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <h3
            className="font-heading line-clamp-2 text-sm leading-snug font-medium text-foreground transition-colors duration-300 ease-out-soft group-hover:text-primary md:text-base"
            title={work.title}
          >
            {work.title}
          </h3>
        </Link>
        {tagLine ? <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">{tagLine}</p> : null}
        <p className="mt-1 text-xs text-muted-foreground/90">{statusLabel(entry)}</p>
        {hasProgressBar ? (
          <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-muted/80">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out-soft"
              style={{ width: `${Math.min(100, state.progressRatio)}%` }}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}
