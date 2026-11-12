'use client';

import { useState } from 'react';

import { t } from '@/i18n';
import type { PublicCategoryListItem } from '@/shared/discovery';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
  const [isExpanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2" aria-hidden>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-20 rounded-full bg-surface-container-high" />
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
        <Button variant="plain" size={null} type="button" className={chipClassName(false)} onClick={() => onRetry?.()}>
          {t(locale, 'content.common.retry')}
        </Button>
      </div>
    );
  }

  if (categories.length === 0) {
    return null;
  }

  const popular = [...categories].sort((a, b) => b.recordCount - a.recordCount).slice(0, 12);
  const selected = categories.find((category) => category.id === selectedCategoryId);
  const visible = isExpanded
    ? categories
    : selected && !popular.some((category) => category.id === selected.id)
      ? [...popular, selected]
      : popular;

  return (
    <nav aria-label={t(locale, 'content.discover.categoriesFilterAria')} className="flex flex-wrap gap-2">
      <Button
        variant="plain"
        size={null}
        type="button"
        aria-pressed={selectedCategoryId === null}
        className={chipClassName(selectedCategoryId === null)}
        onClick={() => onSelect(null)}
      >
        {t(locale, 'content.discover.allCategories')}
      </Button>
      {visible.map((category) => (
        <Button
          variant="plain"
          size={null}
          key={category.id}
          type="button"
          aria-pressed={selectedCategoryId === category.id}
          className={chipClassName(selectedCategoryId === category.id)}
          onClick={() => onSelect(selectedCategoryId === category.id ? null : category.id)}
        >
          {categoryDisplayName(category)}
        </Button>
      ))}
      {categories.length > 12 ? (
        <Button
          variant="plain"
          size={null}
          type="button"
          aria-expanded={isExpanded}
          className={chipClassName(false)}
          onClick={() => setExpanded(!isExpanded)}
        >
          {t(locale, isExpanded ? 'content.discover.fewerCategories' : 'content.discover.moreCategories')}
        </Button>
      ) : null}
    </nav>
  );
}
