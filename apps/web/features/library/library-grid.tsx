'use client';

import type { ReactNode } from 'react';

import type { LibraryItem, UserTagManagementItem } from '@gloaming/shared/library';

import { LibraryBookCard } from '@/features/library/library-book-card';
import { duplicatedLibraryTitleKeys, libraryTitleKey } from '@/features/library/library-title-context';

/** Result grid for the active Library filters; the caller owns the filtered empty state. */
export function LibraryGrid({
  items,
  tags,
  returnTo,
  emptyState,
}: {
  items: LibraryItem[];
  tags: UserTagManagementItem[];
  returnTo?: string;
  emptyState?: ReactNode;
}) {
  if (items.length === 0) return <>{emptyState ?? null}</>;

  // Same-title, different-Work disambiguation is contextual: only the rendered
  // cards participate, so filtering can surface or drop the ambiguity with the list.
  const duplicateTitleKeys = duplicatedLibraryTitleKeys(items.map((entry) => entry.work.title));

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((entry) => (
        <LibraryBookCard
          key={entry.work.id}
          entry={entry}
          tags={tags}
          returnTo={returnTo}
          showTitleContext={duplicateTitleKeys.has(libraryTitleKey(entry.work.title))}
        />
      ))}
    </div>
  );
}
