'use client';

import type { ReactNode } from 'react';

import type { LibraryItem, UserTagManagementItem } from '@gloaming/shared/library';

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
      className={view === 'grid' ? 'grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4' : 'flex flex-col'}
    >
      {items.map((entry) => (
        <LibraryBookCard key={entry.work.id} entry={entry} tags={tags} returnTo={returnTo} view={view} />
      ))}
    </div>
  );
}
