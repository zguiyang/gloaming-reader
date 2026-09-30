'use client';

import { t } from '@gloaming/i18n';
import type { UserTagManagementItem } from '@gloaming/shared/library';

import { useLocale } from '@/lib/locale-context';

export function LibraryTagFilter({
  tags,
  selectedTagId,
  onSelect,
}: {
  tags: UserTagManagementItem[];
  selectedTagId: string | null;
  onSelect: (tagId: string | null) => void;
}) {
  const { locale } = useLocale();
  if (tags.length === 0) return null;

  return (
    <nav
      className="mb-5 flex max-w-full gap-2 overflow-x-auto pb-1"
      aria-label={t(locale, 'content.library.tagFilterAria')}
    >
      <button
        type="button"
        className={`shrink-0 rounded-full border px-3.5 py-2 text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${selectedTagId === null ? 'border-primary/30 bg-brand-soft text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/60'}`}
        aria-pressed={selectedTagId === null}
        onClick={() => onSelect(null)}
      >
        {t(locale, 'content.library.tagFilterAll')}
      </button>
      {tags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          className={`shrink-0 rounded-full border px-3.5 py-2 text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${selectedTagId === tag.id ? 'border-primary/30 bg-brand-soft text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/60'}`}
          aria-pressed={selectedTagId === tag.id}
          onClick={() => onSelect(tag.id)}
        >
          {tag.name}
        </button>
      ))}
    </nav>
  );
}
