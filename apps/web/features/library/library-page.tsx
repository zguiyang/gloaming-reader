'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { useAuthDialog } from '@/features/auth';
import { formatLibraryApiError, libraryQueryKey, useLibraryQuery } from '@/features/library/library-api';
import { LibraryContinueHero } from '@/features/library/library-continue-hero';
import { LibraryEmptyState } from '@/features/library/library-empty-state';
import { LibraryGrid } from '@/features/library/library-grid';
import { LibrarySkeleton } from '@/features/library/library-skeleton';
import { isUnauthorizedError } from '@/lib/api-request';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

function LibraryHeader() {
  const { locale } = useLocale();

  return (
    <header className="mb-8 w-full md:mb-11">
      <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground md:text-4xl md:leading-tight">
        {t(locale, 'content.library.title')}
      </h1>
    </header>
  );
}

function LibraryErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { locale } = useLocale();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-2 py-16 text-center md:py-24">
      <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
        {t(locale, 'content.library.loadFailed')}
      </h2>
      <p className="mt-4 text-base text-muted-foreground">{message}</p>
      <Button className="mt-8 h-12 rounded-full px-10" onClick={onRetry}>
        {t(locale, 'content.common.retry')}
      </Button>
    </div>
  );
}

export function LibraryPage() {
  const queryClient = useQueryClient();
  const { openLogin } = useAuthDialog();
  const libraryQuery = useLibraryQuery();

  useEffect(() => {
    if (libraryQuery.isError && isUnauthorizedError(libraryQuery.error)) {
      openLogin();
    }
  }, [openLogin, libraryQuery.error, libraryQuery.isError]);

  if (libraryQuery.isPending) {
    return (
      <div
        className={cn(
          'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
          'flex w-full flex-col',
        )}
      >
        <LibraryHeader />
        <LibrarySkeleton />
      </div>
    );
  }

  if (libraryQuery.isError && isUnauthorizedError(libraryQuery.error)) {
    return (
      <div
        className={cn(
          'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
          'flex w-full flex-col',
        )}
      >
        <LibraryHeader />
        <LibrarySkeleton />
      </div>
    );
  }

  if (libraryQuery.isError) {
    return (
      <div
        className={cn(
          'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
          'flex w-full flex-col',
        )}
      >
        <LibraryHeader />
        <LibraryErrorState
          message={formatLibraryApiError(libraryQuery.error)}
          onRetry={() => void queryClient.invalidateQueries({ queryKey: libraryQueryKey.all })}
        />
      </div>
    );
  }

  const data = libraryQuery.data;
  const current = data.current;
  const items = current ? data.items.filter((item) => item.work.id !== current.work.id) : data.items;
  const isEmpty = !current && items.length === 0;

  return (
    <div
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
        'flex w-full flex-col',
        isEmpty ? 'min-h-[70dvh]' : '',
      )}
    >
      {isEmpty ? (
        <>
          <LibraryHeader />
          <LibraryEmptyState />
        </>
      ) : (
        <>
          <LibraryHeader />
          <div className="flex flex-col gap-10 md:gap-14">
            {current ? <LibraryContinueHero entry={current} /> : null}
            <LibraryGrid items={items} />
          </div>
        </>
      )}
    </div>
  );
}
