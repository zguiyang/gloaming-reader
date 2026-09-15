'use client';

import { SlidersHorizontalIcon, TagIcon } from 'lucide-react';
import { useState } from 'react';

import { type Locale, t } from '@gloaming/i18n';
import type { CatalogTaxonomyFacet } from '@gloaming/shared/taxonomy';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { taxonomyDisplayName } from '@/features/discover/discover-model';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

const DESKTOP_TAG_CHIP_THRESHOLD = 8;

export type DiscoverFiltersProps = {
  categoryId: string | null;
  categories: readonly CatalogTaxonomyFacet[];
  onCategoryChange: (categoryId: string | null) => void;
  selectedTagIds: readonly string[];
  tags: readonly CatalogTaxonomyFacet[];
  onTagIdsChange: (tagIds: string[]) => void;
  hasActiveFilters: boolean;
};

export function hasDiscoverFilterGroups(
  categories: readonly CatalogTaxonomyFacet[],
  tags: readonly CatalogTaxonomyFacet[],
  hasActiveFilters: boolean,
): boolean {
  return categories.length > 0 || tags.length > 0 || hasActiveFilters;
}

export function toggleTagSelection(selectedTagIds: readonly string[], tagId: string): string[] {
  return selectedTagIds.includes(tagId) ? selectedTagIds.filter((id) => id !== tagId) : [...selectedTagIds, tagId];
}

export function resolveCategorySelection(current: string | null, next: string | null): string | null {
  if (next === null) {
    return null;
  }
  return current === next ? null : next;
}

function taxonomyLabel(ref: CatalogTaxonomyFacet, locale: Locale): string {
  return taxonomyDisplayName(ref, locale);
}

function FilterGroupLabel({ children }: { children: string }) {
  return <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">{children}</p>;
}

function CategoryChip({
  label,
  active,
  onClick,
  ariaLabel,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={cn(
        'shrink-0 rounded-full px-4 py-1.5 text-sm transition-colors duration-200 ease-out-soft',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        active
          ? 'bg-primary font-medium text-primary-foreground'
          : 'border border-border bg-transparent text-muted-foreground hover:bg-surface-container-high md:border-0 md:bg-surface-container',
      )}
    >
      {label}
    </button>
  );
}

function TagChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition-colors duration-200 ease-out-soft',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        active
          ? 'bg-primary font-medium text-primary-foreground'
          : 'border border-border bg-transparent text-muted-foreground hover:bg-surface-container-high md:border-0 md:bg-surface-container',
      )}
    >
      <TagIcon className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
      {label}
    </button>
  );
}

function CategoryFilterRow({
  locale,
  categoryId,
  categories,
  onCategoryChange,
}: {
  locale: Locale;
  categoryId: string | null;
  categories: readonly CatalogTaxonomyFacet[];
  onCategoryChange: (categoryId: string | null) => void;
}) {
  if (categories.length === 0) {
    return null;
  }

  return (
    <section aria-label={t(locale, 'content.discover.categoriesLabel')}>
      <FilterGroupLabel>{t(locale, 'content.discover.categoriesLabel')}</FilterGroupLabel>
      <div className="flex flex-wrap gap-2">
        <CategoryChip
          label={t(locale, 'content.discover.allCategories')}
          active={categoryId === null}
          onClick={() => onCategoryChange(null)}
        />
        {categories.map((category) => (
          <CategoryChip
            key={category.id}
            label={taxonomyLabel(category, locale)}
            active={categoryId === category.id}
            onClick={() => onCategoryChange(resolveCategorySelection(categoryId, category.id))}
          />
        ))}
      </div>
    </section>
  );
}

function DesktopTagFilters({
  locale,
  selectedTagIds,
  tags,
  onTagIdsChange,
}: {
  locale: Locale;
  selectedTagIds: readonly string[];
  tags: readonly CatalogTaxonomyFacet[];
  onTagIdsChange: (tagIds: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const hasSelection = selectedTagIds.length > 0;

  if (tags.length === 0) {
    return null;
  }

  const isPopover = tags.length > DESKTOP_TAG_CHIP_THRESHOLD;

  function clearTags() {
    onTagIdsChange([]);
  }

  if (!isPopover) {
    return (
      <section aria-label={t(locale, 'content.discover.tagsLabel')}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <FilterGroupLabel>{t(locale, 'content.discover.tagsLabel')}</FilterGroupLabel>
          {hasSelection ? (
            <button
              type="button"
              onClick={clearTags}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {t(locale, 'content.discover.clearTags')}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <TagChip label={t(locale, 'content.discover.allTags')} active={!hasSelection} onClick={clearTags} />
          {tags.map((tag) => (
            <TagChip
              key={tag.id}
              label={taxonomyLabel(tag, locale)}
              active={selectedTagIds.includes(tag.id)}
              onClick={() => onTagIdsChange(toggleTagSelection(selectedTagIds, tag.id))}
            />
          ))}
        </div>
      </section>
    );
  }

  const triggerLabel = hasSelection
    ? t(locale, 'content.discover.tagsSelected', { count: selectedTagIds.length })
    : t(locale, 'content.discover.allTags');

  return (
    <section aria-label={t(locale, 'content.discover.tagsLabel')}>
      <FilterGroupLabel>{t(locale, 'content.discover.tagsLabel')}</FilterGroupLabel>
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-2 rounded-full border-border/60 bg-card"
                aria-label={t(locale, 'content.discover.tagsLabel')}
              >
                <TagIcon className="size-4" strokeWidth={1.5} aria-hidden />
                {triggerLabel}
              </Button>
            }
          />
          <PopoverContent align="start" className="w-72 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{t(locale, 'content.discover.tagsLabel')}</p>
              {hasSelection ? (
                <button
                  type="button"
                  onClick={clearTags}
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {t(locale, 'content.discover.clearTags')}
                </button>
              ) : null}
            </div>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              <TagChip
                label={t(locale, 'content.discover.allTags')}
                active={!hasSelection}
                onClick={() => {
                  clearTags();
                  setIsOpen(false);
                }}
              />
              {tags.map((tag) => (
                <TagChip
                  key={tag.id}
                  label={taxonomyLabel(tag, locale)}
                  active={selectedTagIds.includes(tag.id)}
                  onClick={() => onTagIdsChange(toggleTagSelection(selectedTagIds, tag.id))}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {hasSelection ? (
          <div className="flex flex-wrap gap-2">
            {selectedTagIds.map((tagId) => {
              const tag = tags.find((entry) => entry.id === tagId);
              if (!tag) {
                return null;
              }
              return (
                <TagChip
                  key={tagId}
                  label={taxonomyLabel(tag, locale)}
                  active
                  onClick={() => onTagIdsChange(toggleTagSelection(selectedTagIds, tagId))}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function MobileFilterSheet({
  categoryId,
  categories,
  onCategoryChange,
  selectedTagIds,
  tags,
  onTagIdsChange,
  hasActiveFilters,
}: DiscoverFiltersProps) {
  const { locale } = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [draftCategoryId, setDraftCategoryId] = useState<string | null>(categoryId);
  const [draftTagIds, setDraftTagIds] = useState<string[]>([...selectedTagIds]);

  function handleOpenChange(nextIsOpen: boolean) {
    if (nextIsOpen) {
      setDraftCategoryId(categoryId);
      setDraftTagIds([...selectedTagIds]);
    }
    setIsOpen(nextIsOpen);
  }

  const hasCategories = categories.length > 0;
  const hasTags = tags.length > 0;
  const activeCount = (categoryId !== null ? 1 : 0) + selectedTagIds.length;

  function applyDraft() {
    onCategoryChange(draftCategoryId);
    onTagIdsChange(draftTagIds);
    setIsOpen(false);
  }

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 rounded-full border-border/60 bg-card md:hidden"
            aria-label={t(locale, 'content.discover.filter')}
          >
            <SlidersHorizontalIcon className="size-4" strokeWidth={1.5} aria-hidden />
            {t(locale, 'content.discover.filter')}
            {hasActiveFilters ? (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                {activeCount}
              </span>
            ) : null}
          </Button>
        }
      />
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{t(locale, 'content.discover.filterSheetTitle')}</SheetTitle>
          <SheetDescription>{t(locale, 'content.discover.filterSheetDescription')}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex max-h-[min(60dvh,28rem)] flex-col gap-6 overflow-y-auto">
          {hasCategories ? (
            <section aria-label={t(locale, 'content.discover.categoriesLabel')}>
              <FilterGroupLabel>{t(locale, 'content.discover.categoriesLabel')}</FilterGroupLabel>
              <div className="flex flex-wrap gap-2">
                <CategoryChip
                  label={t(locale, 'content.discover.allCategories')}
                  active={draftCategoryId === null}
                  onClick={() => setDraftCategoryId(null)}
                />
                {categories.map((category) => (
                  <CategoryChip
                    key={category.id}
                    label={taxonomyLabel(category, locale)}
                    active={draftCategoryId === category.id}
                    onClick={() => setDraftCategoryId(resolveCategorySelection(draftCategoryId, category.id))}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {hasTags ? (
            <section aria-label={t(locale, 'content.discover.tagsLabel')}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <FilterGroupLabel>{t(locale, 'content.discover.tagsLabel')}</FilterGroupLabel>
                {draftTagIds.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setDraftTagIds([])}
                    className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {t(locale, 'content.discover.clearTags')}
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <TagChip
                  label={t(locale, 'content.discover.allTags')}
                  active={draftTagIds.length === 0}
                  onClick={() => setDraftTagIds([])}
                />
                {tags.map((tag) => (
                  <TagChip
                    key={tag.id}
                    label={taxonomyLabel(tag, locale)}
                    active={draftTagIds.includes(tag.id)}
                    onClick={() => setDraftTagIds(toggleTagSelection(draftTagIds, tag.id))}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {!hasCategories && !hasTags && hasActiveFilters ? (
            <p className="text-sm text-muted-foreground">{t(locale, 'content.discover.filterSheetActiveOnly')}</p>
          ) : null}
        </div>

        <div className="mt-6 border-t border-border/60 pt-4">
          <Button type="button" className="h-11 w-full rounded-full" onClick={applyDraft}>
            {t(locale, 'content.discover.showResults')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function DiscoverFilters(props: DiscoverFiltersProps) {
  const { locale } = useLocale();
  const { categoryId, categories, onCategoryChange, selectedTagIds, tags, onTagIdsChange } = props;

  if (!hasDiscoverFilterGroups(categories, tags, props.hasActiveFilters)) {
    return null;
  }

  const isDesktopCategories = categories.length > 0;
  const isDesktopTags = tags.length > 0;

  return (
    <div className="mb-8 flex items-start justify-between gap-4 md:mb-10">
      <div className="hidden min-w-0 flex-1 flex-col gap-5 md:flex">
        {isDesktopCategories ? (
          <CategoryFilterRow
            locale={locale}
            categoryId={categoryId}
            categories={categories}
            onCategoryChange={onCategoryChange}
          />
        ) : null}
        {isDesktopTags ? (
          <DesktopTagFilters
            locale={locale}
            selectedTagIds={selectedTagIds}
            tags={tags}
            onTagIdsChange={onTagIdsChange}
          />
        ) : null}
      </div>
      <MobileFilterSheet {...props} />
    </div>
  );
}
