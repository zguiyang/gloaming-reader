'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { useAuthDialog } from '@/features/auth';
import { formatShelfApiError, shelfQueryKey, useShelfQuery } from '@/features/shelf/shelf-api';
import { ShelfContinueHero } from '@/features/shelf/shelf-continue-hero';
import { ShelfEmptyState } from '@/features/shelf/shelf-empty-state';
import { ShelfGrid } from '@/features/shelf/shelf-grid';
import { ShelfSkeleton } from '@/features/shelf/shelf-skeleton';
import { isUnauthorizedError } from '@/lib/api-request';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

function ShelfHeader({ hasResumeHint }: { hasResumeHint: boolean }) {
  const { locale } = useLocale();

  return (
    <header className="mb-10 w-full text-left md:mx-auto md:mb-14 md:max-w-xl md:text-center">
      <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-5xl md:leading-[1.15]">
        {t(locale, 'content.shelf.title')}
      </h1>
      {hasResumeHint ? (
        <p className="mt-3 text-base text-muted-foreground md:mt-4 md:text-xl md:leading-8">
          {t(locale, 'content.shelf.subtitleResume')}
        </p>
      ) : null}
    </header>
  );
}

function ShelfErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { locale } = useLocale();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-2 py-16 text-center md:py-24">
      <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
        {t(locale, 'content.shelf.loadFailed')}
      </h2>
      <p className="mt-4 text-base text-muted-foreground">{message}</p>
      <Button className="mt-8 h-12 rounded-full px-10" onClick={onRetry}>
        {t(locale, 'content.common.retry')}
      </Button>
    </div>
  );
}

export function ShelfPage() {
  const queryClient = useQueryClient();
  const { openLogin } = useAuthDialog();
  const shelfQuery = useShelfQuery();

  useEffect(() => {
    if (shelfQuery.isError && isUnauthorizedError(shelfQuery.error)) {
      openLogin();
    }
  }, [openLogin, shelfQuery.error, shelfQuery.isError]);

  if (shelfQuery.isPending) {
    return (
      <div
        className={cn(
          'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
          'flex w-full flex-col',
        )}
      >
        <ShelfHeader hasResumeHint={false} />
        <ShelfSkeleton />
      </div>
    );
  }

  if (shelfQuery.isError && isUnauthorizedError(shelfQuery.error)) {
    return (
      <div
        className={cn(
          'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
          'flex w-full flex-col',
        )}
      >
        <ShelfHeader hasResumeHint={false} />
        <ShelfSkeleton />
      </div>
    );
  }

  if (shelfQuery.isError) {
    return (
      <div
        className={cn(
          'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
          'flex w-full flex-col',
        )}
      >
        <ShelfHeader hasResumeHint={false} />
        <ShelfErrorState
          message={formatShelfApiError(shelfQuery.error)}
          onRetry={() => void queryClient.invalidateQueries({ queryKey: shelfQueryKey.all })}
        />
      </div>
    );
  }

  const data = shelfQuery.data;
  const current = data.current;
  const items = data.items;
  const isEmpty = !current && items.length === 0;

  return (
    <div
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
        'flex w-full flex-col',
        isEmpty ? 'min-h-[70dvh] justify-center' : '',
      )}
    >
      {isEmpty ? (
        <>
          <ShelfHeader hasResumeHint={false} />
          <ShelfEmptyState />
        </>
      ) : (
        <>
          <ShelfHeader hasResumeHint />
          <div className="flex flex-col gap-14 md:gap-20">
            {current ? <ShelfContinueHero entry={current} /> : null}
            <ShelfGrid items={items} />
          </div>
        </>
      )}
    </div>
  );
}
