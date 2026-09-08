'use client';

import { BookOpenIcon } from 'lucide-react';
import Link from 'next/link';

import type { ShelfItem } from '@gloaming/shared/shelf';

import { Button } from '@/components/ui/button';
import { AUTH_ROUTES } from '@/constants';
import { BookDetailCover } from '@/features/book-detail/book-detail-cover';
import { coverUrlFromAssetId } from '@/lib/asset-url';
import { cn } from '@/lib/utils';

function metaLine(entry: ShelfItem): string {
  const parts: string[] = [];
  if (entry.work.tags[0]) {
    parts.push(entry.work.tags[0]);
  }
  return parts.join(' · ');
}

export function ShelfContinueHero({ entry }: { entry: ShelfItem }) {
  const ratio = entry.state.progressRatio;
  const detailHref = AUTH_ROUTES.bookDetail(entry.work.id);
  const readHref = AUTH_ROUTES.readBook(entry.work.id, entry.state.currentPartId ?? undefined);
  const coverImageUrl = coverUrlFromAssetId(entry.work.coverAssetId);

  return (
    <section className="mb-10 w-full md:mb-14">
      <div className="mb-4 flex items-center border-b border-border/40 pb-4">
        <h3 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">继续阅读</h3>
      </div>
      <div
        className={cn(
          'group relative flex flex-col gap-6 overflow-hidden rounded-2xl bg-paper p-6 md:flex-row md:items-center md:gap-10 md:p-8',
        )}
      >
        <Link
          href={detailHref}
          className="mx-auto shrink-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:mx-0"
          aria-label={`查看《${entry.work.title}》详情`}
        >
          <BookDetailCover
            title={entry.work.title}
            tags={entry.work.tags}
            coverImageUrl={coverImageUrl}
            className="aspect-[2/3] w-32 md:w-36"
          />
        </Link>

        <div className="min-w-0 flex-1 text-center md:text-left">
          <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {metaLine(entry) || '阅读中'}
          </p>
          <Link href={detailHref} className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <h2 className="font-heading mb-4 text-2xl leading-tight font-semibold text-foreground transition-colors duration-300 ease-out-soft hover:text-primary md:text-3xl">
              {entry.work.title}
            </h2>
          </Link>
          <div className="mx-auto mb-5 max-w-md md:mx-0">
            <div className="mb-2 flex justify-between text-sm text-muted-foreground">
              <span className="font-medium text-primary">已读 {ratio}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/80">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out-soft"
                style={{ width: `${Math.min(100, ratio)}%` }}
              />
            </div>
          </div>
          <Button
            nativeButton={false}
            className="h-11 rounded-xl px-8 shadow-sm hover:bg-brand-deep active:scale-[0.98]"
            render={<Link href={readHref} />}
          >
            <BookOpenIcon className="size-4" strokeWidth={1.5} aria-hidden />
            继续阅读
          </Button>
        </div>
      </div>
    </section>
  );
}
