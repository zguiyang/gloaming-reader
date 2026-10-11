'use client';

import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { t } from '@gloaming/i18n';
import { resolveUserTagName } from '@gloaming/shared/library';

import { Button } from '@/components/ui/button';
import { AUTH_ROUTES } from '@/constants';
import { useAuthDialog } from '@/features/auth';
import {
  formatLibraryApiError,
  libraryQueryKey,
  useLibraryQuery,
  useUserTagsQuery,
} from '@/features/library/library-api';
import { LibraryContinueHero } from '@/features/library/library-continue-hero';
import { LibraryEmptyState } from '@/features/library/library-empty-state';
import {
  buildLibraryFilterQuery,
  isLibraryFilterActive,
  libraryFilterHref,
  type LibraryFilters,
  mayBeTruncated,
  normalizeLibraryFilterSearch,
  parseLibraryFilters,
} from '@/features/library/library-filters';
import { LibraryGrid } from '@/features/library/library-grid';
import { LibrarySkeleton } from '@/features/library/library-skeleton';
import { LibraryMobileSourceNav, LibrarySourceNav } from '@/features/library/library-source-nav';
import { isUnauthorizedError } from '@/lib/api-request';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

const TAG_ID_SEPARATOR = '\u0000';

function LibraryHeader() {
  const { locale } = useLocale();

  return (
    <header className="mb-6 flex w-full items-center justify-between gap-4 md:mb-8">
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

/**
 * The URL is the durable Library filter state. Keying the content by the search string restores it
 * on refresh and browser back/forward without syncing React state inside an effect.
 */
export function LibraryPage() {
  return (
    <Suspense fallback={<LibraryPageFallback />}>
      <LibraryPageWithUrlState />
    </Suspense>
  );
}

function LibraryPageFallback() {
  return (
    <div className="flex w-full flex-col">
      <LibraryHeader />
      <LibrarySkeleton />
    </div>
  );
}

function LibraryPageWithUrlState() {
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString() ?? '';

  return <LibraryPageContent key={searchKey} searchKey={searchKey} />;
}

function LibraryPageContent({ searchKey }: { searchKey: string }) {
  const queryClient = useQueryClient();
  const { openLogin } = useAuthDialog();
  const libraryQuery = useLibraryQuery();
  const tagsQuery = useUserTagsQuery();
  const router = useRouter();
  const pathname = usePathname() ?? AUTH_ROUTES.library;
  const { locale } = useLocale();

  const hasTagsLoaded = tagsQuery.data !== undefined;
  const tags = tagsQuery.data ?? [];
  const validTagIdsKey = hasTagsLoaded ? tags.map((tag) => tag.id).join(TAG_ID_SEPARATOR) : null;

  const [filters, setFilters] = useState<LibraryFilters>(() =>
    parseLibraryFilters(searchKey ? new URLSearchParams(searchKey) : null),
  );

  // Safely normalize invalid/redundant source or tag parameters once user tags are known.
  useEffect(() => {
    if (!hasTagsLoaded) return;
    const params = searchKey ? new URLSearchParams(searchKey) : null;
    const validTagIds = (validTagIdsKey ?? '').split(TAG_ID_SEPARATOR).filter(Boolean);
    const normalized = normalizeLibraryFilterSearch(parseLibraryFilters(params, validTagIds), params, validTagIds);
    if (normalized !== null) {
      router.replace(normalized ? `${pathname}?${normalized}` : pathname, { scroll: false });
    }
  }, [pathname, router, searchKey, hasTagsLoaded, validTagIdsKey]);

  useEffect(() => {
    if (libraryQuery.isError && isUnauthorizedError(libraryQuery.error)) {
      openLogin();
    }
  }, [openLogin, libraryQuery.error, libraryQuery.isError]);

  // A tag that is not (or no longer) one of the user's tags is treated as no tag condition.
  const isTagValid = filters.tagId === null || !hasTagsLoaded || tags.some((tag) => tag.id === filters.tagId);
  const effectiveFilters: LibraryFilters = { source: filters.source, tagId: isTagValid ? filters.tagId : null };

  const applyFilters = (next: LibraryFilters) => {
    if (next.source === effectiveFilters.source && next.tagId === effectiveFilters.tagId) return;
    setFilters(next);
    const query = buildLibraryFilterQuery(next, searchKey ? new URLSearchParams(searchKey) : undefined);
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

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
  const items = data.items;
  const activeTag = effectiveFilters.tagId ? (tags.find((tag) => tag.id === effectiveFilters.tagId) ?? null) : null;
  const isFilterActive = isLibraryFilterActive(effectiveFilters);
  const isTruncated = mayBeTruncated(items.length);
  const filteredItems = items.filter((item) => {
    const isSourceMatch =
      effectiveFilters.source === 'all' ||
      item.libraryItemKind === (effectiveFilters.source === 'saved' ? 'saved_catalog' : 'personal');
    const isTagMatch = !effectiveFilters.tagId || item.userTags.some((tag) => tag.id === effectiveFilters.tagId);
    return isSourceMatch && isTagMatch;
  });
  const isEmpty = !current && items.length === 0;

  const sourceLabel =
    effectiveFilters.source === 'personal'
      ? t(locale, 'content.library.sourcePersonal')
      : effectiveFilters.source === 'saved'
        ? t(locale, 'content.library.sourceSaved')
        : t(locale, 'content.library.allBooks');
  const currentLabel = activeTag ? `${sourceLabel} · ${resolveUserTagName(activeTag, locale)}` : sourceLabel;

  const sourceNavProps = {
    filters: effectiveFilters,
    tags,
    tagsLoading: !hasTagsLoaded,
    onSelectSource: (source: LibraryFilters['source']) => applyFilters({ ...effectiveFilters, source }),
    onSelectTag: (tagId: string | null) => applyFilters({ ...effectiveFilters, tagId }),
  };

  if (isEmpty) {
    return (
      <div
        className={cn(
          'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
          'flex w-full flex-col',
          'min-h-[70dvh]',
        )}
      >
        <LibraryHeader />
        <LibraryEmptyState />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
        'flex w-full flex-col',
      )}
    >
      <LibraryHeader />
      <div className="flex w-full gap-8 lg:gap-10">
        <LibrarySourceNav {...sourceNavProps} />
        <div className="flex min-w-0 flex-1 flex-col gap-8 md:gap-10">
          <LibraryMobileSourceNav currentLabel={currentLabel} {...sourceNavProps} />
          {current ? <LibraryContinueHero entry={current} /> : null}
          {isFilterActive ? (
            <div className="flex items-center gap-3">
              <h2 className="font-heading hidden min-w-0 truncate text-lg font-semibold tracking-tight text-foreground md:block">
                {currentLabel}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto shrink-0 text-muted-foreground"
                onClick={() => applyFilters({ source: 'all', tagId: null })}
              >
                {t(locale, 'content.library.clearFilter')}
              </Button>
            </div>
          ) : null}
          <LibraryGrid
            items={filteredItems}
            tags={tags}
            returnTo={libraryFilterHref(effectiveFilters)}
            emptyState={
              <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
                <p className="text-sm text-muted-foreground">
                  {t(
                    locale,
                    isTruncated
                      ? 'content.library.noMatchTruncated'
                      : effectiveFilters.tagId
                        ? 'content.library.noMatchTitle'
                        : effectiveFilters.source === 'saved'
                          ? 'content.library.noSavedBooks'
                          : effectiveFilters.source === 'personal'
                            ? 'content.library.noUploadedBooks'
                            : 'content.library.noMatchTitle',
                  )}
                </p>
                {!isTruncated && !effectiveFilters.tagId && effectiveFilters.source !== 'all' ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-sm"
                    onClick={() => applyFilters({ source: 'all', tagId: null })}
                  >
                    {t(locale, 'content.library.viewAllBooks')}
                  </Button>
                ) : null}
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
