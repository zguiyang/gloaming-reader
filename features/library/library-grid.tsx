'use client';

import type { ReactNode } from 'react';

import type { LibraryItem, UserTagManagementItem } from '@/shared/library';

import { LibraryBookCard } from '@/features/library/library-book-card';

/** Result grid for the active Library filters; the caller owns the filtered empty state. */
export function LibraryGrid({
  items,
  tags,
  returnTo,
  emptyState,
  view = 'grid',
}: {
  items: LibraryItem[];
  tags: UserTagManagementItem[];
  returnTo?: string;
  emptyState?: ReactNode;
  view?: 'grid' | 'list';
}) {
  if (items.length === 0) return <>{emptyState ?? null}</>;

  return (
    <div
      className={
        view === 'grid'
          ? 'grid grid-cols-3 gap-x-3 gap-y-5 sm:gap-x-4 sm:gap-y-6 lg:grid-cols-4 xl:grid-cols-5'
          : 'flex flex-col'
      }
    >
      {items.map((entry) => (
        <LibraryBookCard key={entry.work.id} entry={entry} tags={tags} returnTo={returnTo} view={view} />
      ))}
    </div>
  );
}
