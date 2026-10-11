'use client';

import type { UserTagManagementItem } from '@gloaming/shared/library';

import { cn } from '@/lib/utils';

/** Vertical tag list for the Library source navigation. Selecting an active tag clears it. */
export function LibraryTagFilter({
  tags,
  selectedTagId,
  onSelect,
}: {
  tags: UserTagManagementItem[];
  selectedTagId: string | null;
  onSelect: (tagId: string | null) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {tags.map((tag) => {
        const isActive = selectedTagId === tag.id;
        return (
          <li key={tag.id}>
            <button
              type="button"
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'flex min-h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors duration-200 ease-out-soft focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                isActive
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              onClick={() => onSelect(isActive ? null : tag.id)}
            >
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{tag.bookCount}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
