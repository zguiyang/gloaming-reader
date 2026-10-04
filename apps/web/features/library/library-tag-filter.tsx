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
      className="mb-6 flex max-w-full gap-4 overflow-x-auto pb-1"
      aria-label={t(locale, 'content.library.tagFilterAria')}
    >
      <button
        type="button"
        className={`min-h-9 shrink-0 text-sm underline-offset-4 transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${selectedTagId === null ? 'font-medium text-foreground underline decoration-primary decoration-1' : 'text-muted-foreground hover:text-foreground'}`}
        aria-pressed={selectedTagId === null}
        onClick={() => onSelect(null)}
      >
        {t(locale, 'content.library.tagFilterAll')}
      </button>
      {tags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          className={`min-h-9 shrink-0 text-sm underline-offset-4 transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${selectedTagId === tag.id ? 'font-medium text-foreground underline decoration-primary decoration-1' : 'text-muted-foreground hover:text-foreground'}`}
          aria-pressed={selectedTagId === tag.id}
          onClick={() => onSelect(tag.id)}
        >
          {tag.name}
        </button>
      ))}
    </nav>
  );
}
