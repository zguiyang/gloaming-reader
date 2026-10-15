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
  /** True only when the category list itself failed and no data is available. */
  isError?: boolean;
  onRetry?: () => void;
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
  isError = false,
  onRetry,
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

  // A failed category load must stay visible and retryable instead of silently
  // collapsing into an empty filter row.
  if (isError && categories.length === 0) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{t(locale, 'content.discover.loadFailed')}</span>
        <button type="button" className={chipClassName(false)} onClick={() => onRetry?.()}>
          {t(locale, 'content.common.retry')}
        </button>
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
