'use client';

import { ArrowRightIcon, BookmarkIcon, CheckIcon, Loader2Icon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AUTH_ROUTES } from '@/constants';
import { useAuthDialog } from '@/features/auth';
import { saveSourceRecordToLibrary } from '@/features/discover/discover-api';
import { categoryDisplayName, type DiscoverItem } from '@/features/discover/discover-model';
import { WorkCover } from '@/features/work-cover';
import { isUnauthorizedError } from '@/lib/api-request';
import { useLocale } from '@/lib/locale-context';
import { workDetailHref } from '@/lib/navigation/work-detail-return';
import { cn } from '@/lib/utils';

type DiscoverSourceCardProps = {
  item: DiscoverItem;
};

type SaveIntentState = 'idle' | 'saving' | 'pending' | 'ready';

/**
 * SourceRecord Discover card.
 *
 * A materialized SourceRecord keeps the existing Reader/Library entry through its
 * explicit `linkedWorkId`. An unmaterialized SourceRecord has no readable Work
 * yet, so its only action is an explicit Save Intent that materializes on demand.
 */
export function DiscoverSourceCard({ item }: DiscoverSourceCardProps) {
  const { locale } = useLocale();
  const { openLogin } = useAuthDialog();
  const [saveState, setSaveState] = useState<SaveIntentState>('idle');

  const detailHref = item.linkedWorkId ? workDetailHref(item.linkedWorkId, AUTH_ROUTES.discover) : null;

  async function handleSaveIntent() {
    if (saveState !== 'idle') {
      return;
    }
    setSaveState('saving');
    try {
      const result = await saveSourceRecordToLibrary(item.id);
      setSaveState(result.status);
      if (result.status === 'ready') {
        toast.success(t(locale, 'content.discover.saveReady'));
      } else {
        toast.info(t(locale, 'content.discover.savePending'));
      }
    } catch (error) {
      setSaveState('idle');
      if (isUnauthorizedError(error)) {
        openLogin();
        return;
      }
      toast.error(t(locale, 'content.discover.saveFailed'));
    }
  }

  const isSaved = saveState === 'ready';
  const isPreparing = saveState === 'pending';
  const isBusy = saveState === 'saving' || isPreparing;

  const cover = <WorkCover title={item.title} coverImageUrl={item.coverImageUrl} className="aspect-[2/3] rounded-sm" />;

  return (
    <article className="flex flex-col gap-3">
      {detailHref ? (
        <Link
          href={detailHref}
          className={cn(
            'relative outline-none',
            'transition-transform duration-300 ease-out-soft',
            'hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50',
          )}
          aria-label={t(locale, 'content.common.viewBookDetailAria', { title: item.title })}
        >
          {cover}
        </Link>
      ) : (
        cover
      )}

      <div className="flex min-w-0 flex-col">
        <h3
          className="font-heading line-clamp-2 text-sm leading-snug font-medium text-foreground md:text-base"
          title={item.title}
        >
          {detailHref ? (
            <Link
              href={detailHref}
              className="transition-colors duration-300 ease-out-soft hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {item.title}
            </Link>
          ) : (
            item.title
          )}
        </h3>
        {item.author ? (
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground md:text-[13px]">{item.author}</p>
        ) : null}

        {item.categories.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t(locale, 'content.discover.categoriesAria')}>
            {item.categories.map((category) => (
              <li key={category.id}>
                <Badge variant="secondary" className="rounded-full bg-accent font-normal text-accent-foreground">
                  {categoryDisplayName(category)}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-3">
          {detailHref ? (
            <Button nativeButton={false} variant="outline" className="h-8 gap-1.5" render={<Link href={detailHref} />}>
              {t(locale, 'content.discover.viewDetail')}
              <ArrowRightIcon className="size-4" strokeWidth={1.5} aria-hidden />
            </Button>
          ) : isSaved ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled
                className="h-8 cursor-default gap-1.5 bg-surface-container-high text-muted-foreground shadow-none disabled:opacity-100"
              >
                <CheckIcon className="size-4" strokeWidth={1.5} aria-hidden />
                {t(locale, 'content.discover.inLibrary')}
              </Button>
              <Button
                nativeButton={false}
                variant="link"
                className="h-8 px-0"
                render={<Link href={AUTH_ROUTES.library} />}
              >
                {t(locale, 'content.discover.goToLibrary')}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              className="h-8 gap-1.5"
              onClick={() => {
                void handleSaveIntent();
              }}
            >
              {isBusy ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden />
              ) : (
                <BookmarkIcon className="size-4" strokeWidth={1.5} aria-hidden />
              )}
              {isPreparing ? t(locale, 'content.discover.preparing') : t(locale, 'content.discover.addToLibrary')}
            </Button>
          )}
          {!detailHref && isPreparing ? (
            <p className="mt-1.5 text-xs text-muted-foreground">{t(locale, 'content.discover.preparingHint')}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
