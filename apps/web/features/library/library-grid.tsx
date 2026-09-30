'use client';

import { t } from '@gloaming/i18n';
import type { LibraryItem, UserTagManagementItem } from '@gloaming/shared/library';

import { LibraryBookCard } from '@/features/library/library-book-card';
import { LibraryTagFilter } from '@/features/library/library-tag-filter';
import { useLocale } from '@/lib/locale-context';

export function LibraryGrid({
  items,
  tags,
  selectedTagId,
  onSelectTag,
}: {
  items: LibraryItem[];
  tags: UserTagManagementItem[];
  selectedTagId: string | null;
  onSelectTag: (tagId: string | null) => void;
}) {
  const { locale } = useLocale();
  if (items.length === 0 && selectedTagId === null) return null;

  return (
    <section className="w-full">
      <div className="mb-5 flex items-center border-b border-border/40 pb-3 md:mb-6">
        <h3 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
          {t(locale, 'content.library.allBooks')}
        </h3>
      </div>
      <LibraryTagFilter tags={tags} selectedTagId={selectedTagId} onSelect={onSelectTag} />
      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t(locale, 'content.library.filterNoMatches')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 md:gap-x-7 md:gap-y-10 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((entry) => (
            <LibraryBookCard key={entry.work.id} entry={entry} tags={tags} />
          ))}
        </div>
      )}
    </section>
  );
}
