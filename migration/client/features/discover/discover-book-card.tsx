'use client';

import Link from 'next/link';

import { t } from '@gloaming/i18n';

import { AUTH_ROUTES } from '@/constants';
import type { DiscoverLegacyWork } from '@/features/discover/discover-model';
import { WorkCover } from '@/features/work-cover';
import { useLocale } from '@/lib/locale-context';
import { workDetailHref } from '@/lib/navigation/work-detail-return';
import { cn } from '@/lib/utils';

type DiscoverBookCardProps = {
  item: DiscoverLegacyWork;
};

/**
 * Compatibility card for an already-published Catalog Work with no SourceRecord.
 * It keeps the existing ReadingWork identity and detail link instead of faking a
 * SourceRecord.
 */
export function DiscoverBookCard({ item }: DiscoverBookCardProps) {
  const { locale } = useLocale();
  const detailHref = workDetailHref(item.id, AUTH_ROUTES.discover);

  return (
    <article className="group flex h-full flex-col items-stretch gap-3">
      <Link
        href={detailHref}
        className={cn(
          'relative outline-none',
          'transition-transform duration-300 ease-out-soft',
          'hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50',
        )}
        aria-label={t(locale, 'content.common.viewBookDetailAria', { title: item.title })}
      >
        <WorkCover title={item.title} coverImageUrl={item.coverImageUrl} className="aspect-[2/3] rounded-sm" />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <Link href={detailHref} className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <h3
            className="font-heading line-clamp-2 min-h-[2lh] text-sm leading-snug font-medium text-foreground transition-colors duration-300 ease-out-soft group-hover:text-primary md:text-base"
            title={item.title}
          >
            {item.title}
          </h3>
        </Link>
        {/* Reserved one-line author row keeps sibling cards' action areas aligned. */}
        <p className="mt-1 min-h-[1lh] line-clamp-1 text-xs text-muted-foreground md:text-[13px]">
          {item.author ?? ''}
        </p>
        <p className="mt-1 text-xs text-muted-foreground/80">
          {t(locale, 'content.discover.chapterCount', { count: item.partCount })}
        </p>
      </div>
    </article>
  );
}
