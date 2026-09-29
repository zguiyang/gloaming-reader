'use client';

import { BookOpenIcon } from 'lucide-react';
import Link from 'next/link';

import { type Locale, t } from '@gloaming/i18n';
import type { ContinueReadingItem } from '@gloaming/shared/library';
import { resolveLocalizedText } from '@gloaming/shared/taxonomy';

import { Button } from '@/components/ui/button';
import { AUTH_ROUTES } from '@/constants';
import { WorkCover } from '@/features/work-cover';
import { coverUrlFromAssetId } from '@/lib/asset-url';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

function metaLine(entry: ContinueReadingItem, locale: Locale): string {
  const parts: string[] = [];
  const firstTag = entry.work.tags[0];
  if (firstTag) {
    const label = resolveLocalizedText(firstTag.names, locale);
    if (label) {
      parts.push(label);
    }
  }
  return parts.join(' · ');
}

function progressLabel(ratio: number, locale: Locale): string {
  return t(locale, 'content.library.progressRead', { ratio });
}

export function LibraryContinueHero({ entry }: { entry: ContinueReadingItem }) {
  const { locale } = useLocale();
  const ratio = entry.state.progressRatio;
  const readHref = AUTH_ROUTES.readBook(entry.work.id, entry.state.currentPartId ?? undefined);
  const coverImageUrl = coverUrlFromAssetId(entry.work.coverAssetId);

  return (
    <section className="w-full">
      <div className="mb-4 flex items-center border-b border-border/40 pb-3">
        <h3 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {t(locale, 'content.library.continueReading')}
        </h3>
      </div>
      <div className={cn('group relative flex flex-row items-center gap-4 rounded-xl bg-paper/65 p-4 md:gap-6 md:p-5')}>
        <Link
          href={readHref}
          className="shrink-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={t(locale, 'content.common.openReaderAria', { title: entry.work.title })}
        >
          <WorkCover
            title={entry.work.title}
            tags={entry.work.tags.map((tag) => tag.id)}
            coverImageUrl={coverImageUrl}
            className="aspect-[2/3] w-20 md:w-24"
          />
        </Link>

        <div className="min-w-0 flex-1 text-left">
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            {metaLine(entry, locale) || t(locale, 'content.library.readingInProgress')}
          </p>
          <Link href={readHref} className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <h2 className="font-heading mb-3 line-clamp-2 text-lg leading-snug font-semibold text-foreground transition-colors duration-300 ease-out-soft hover:text-primary md:text-xl">
              {entry.work.title}
            </h2>
          </Link>
          <div className="mb-3 max-w-md">
            <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
              <span className="font-medium text-primary">{progressLabel(ratio, locale)}</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted/80">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out-soft"
                style={{ width: `${Math.min(100, ratio)}%` }}
              />
            </div>
          </div>
          <Button
            nativeButton={false}
            variant="ghost"
            className="-ml-2 h-9 rounded-lg px-2 text-sm font-medium text-primary hover:bg-background/70 active:scale-[0.98]"
            render={<Link href={readHref} />}
          >
            <BookOpenIcon className="size-4" strokeWidth={1.5} aria-hidden />
            {t(locale, 'content.library.continueReading')}
          </Button>
        </div>
      </div>
    </section>
  );
}
