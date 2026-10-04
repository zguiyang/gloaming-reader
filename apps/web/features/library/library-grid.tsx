'use client';

import { t } from '@gloaming/i18n';
import type { LibraryItem, UserTagManagementItem } from '@gloaming/shared/library';

import { LibraryBookCard } from '@/features/library/library-book-card';
import { LibraryTagFilter } from '@/features/library/library-tag-filter';
import { useLocale } from '@/lib/locale-context';

type LibrarySource = 'all' | 'personal' | 'saved_catalog';

export function LibraryGrid({
  items,
  tags,
  selectedSource,
  onSelectSource,
  selectedTagId,
  onSelectTag,
}: {
  items: LibraryItem[];
  tags: UserTagManagementItem[];
  selectedSource: LibrarySource;
  onSelectSource: (source: LibrarySource) => void;
  selectedTagId: string | null;
  onSelectTag: (tagId: string | null) => void;
}) {
  const { locale } = useLocale();
  if (items.length === 0 && selectedSource === 'all' && selectedTagId === null) return null;

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center md:mb-4">
        <h3 className="font-heading text-xl font-semibold tracking-tight text-foreground md:text-2xl">
          {t(locale, 'content.library.allBooks')}
        </h3>
      </div>
      <nav
        className="mb-3 flex max-w-full gap-5 overflow-x-auto border-b border-border/50"
        aria-label={t(locale, 'content.library.sourceFilterAria')}
      >
        {(
          [
            ['all', 'content.library.sourceAll'],
            ['personal', 'content.library.sourcePersonal'],
            ['saved_catalog', 'content.library.sourceSaved'],
          ] as const
        ).map(([source, label]) => (
          <button
            key={source}
            type="button"
            className={`relative min-h-11 shrink-0 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${selectedSource === source ? 'font-medium text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            aria-pressed={selectedSource === source}
            onClick={() => onSelectSource(source)}
          >
            {t(locale, label)}
            {selectedSource === source ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" aria-hidden />
            ) : null}
          </button>
        ))}
      </nav>
      <LibraryTagFilter tags={tags} selectedTagId={selectedTagId} onSelect={onSelectTag} />
      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t(locale, 'content.library.filterNoMatches')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 md:gap-x-5 md:gap-y-8 lg:grid-cols-5 lg:gap-x-6 xl:grid-cols-6">
          {items.map((entry) => (
            <LibraryBookCard key={entry.work.id} entry={entry} tags={tags} />
          ))}
        </div>
      )}
    </section>
  );
}
