'use client';

import { t } from '@gloaming/i18n';
import type { PublicCategoryListItem } from '@gloaming/shared/discovery';

import { categoryDisplayName } from '@/features/discover/discover-model';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type DiscoverCategoriesProps = {
  categories: PublicCategoryListItem[];
  selectedCategoryId: string | null;
  onSelect: (categoryId: string | null) => void;
  isLoading?: boolean;
};

const chipClassName = (isActive: boolean) =>
  cn(
    'inline-flex h-8 items-center rounded-full border px-3.5 text-sm transition-colors duration-200 ease-out-soft',
    'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
    isActive
      ? 'border-transparent bg-accent font-medium text-accent-foreground'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
  );

/** Localized public category filter; the active chip is the current filter state. */
export function DiscoverCategories({
  categories,
  selectedCategoryId,
  onSelect,
  isLoading = false,
}: DiscoverCategoriesProps) {
  const { locale } = useLocale();

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2" aria-hidden>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-8 w-20 animate-pulse rounded-full bg-surface-container-high" />
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return null;
  }

  return (
    <nav aria-label={t(locale, 'content.discover.categoriesFilterAria')} className="flex flex-wrap gap-2">
      <button
        type="button"
        aria-pressed={selectedCategoryId === null}
        className={chipClassName(selectedCategoryId === null)}
        onClick={() => onSelect(null)}
      >
        {t(locale, 'content.discover.allCategories')}
      </button>
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          aria-pressed={selectedCategoryId === category.id}
          className={chipClassName(selectedCategoryId === category.id)}
          onClick={() => onSelect(selectedCategoryId === category.id ? null : category.id)}
        >
          {categoryDisplayName(category)}
        </button>
      ))}
    </nav>
  );
}
