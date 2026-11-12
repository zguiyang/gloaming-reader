'use client';

import { CheckIcon, Loader2Icon, SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@/i18n';
import { type GutenbergShelfTerm, type PublicCategoryManagementItem } from '@/shared/discovery';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatPublicCategoriesApiError,
  useGutenbergShelfTermsQuery,
  useSaveCategoryShelfTermsMutation,
} from '@/features/admin/public-categories/public-categories-api';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type Props = {
  category: PublicCategoryManagementItem;
};

type EditorProps = {
  category: PublicCategoryManagementItem;
  items: GutenbergShelfTerm[];
  initialSelectedIds: string[];
};

function sortTerms(a: GutenbergShelfTerm, b: GutenbergShelfTerm): number {
  return a.displayName.localeCompare(b.displayName) || a.mappingId.localeCompare(b.mappingId);
}

function CategoryShelfEditor({ category, items, initialSelectedIds }: EditorProps) {
  const { locale } = useLocale();
  const saveMutation = useSaveCategoryShelfTermsMutation();
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set(initialSelectedIds));
  const [isDirty, setIsDirty] = useState(false);

  const { assigned, available } = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? items.filter(
          (item) => item.displayName.toLowerCase().includes(term) || item.sourceValue.toLowerCase().includes(term),
        )
      : items;
    const assignedItems: GutenbergShelfTerm[] = [];
    const availableItems: GutenbergShelfTerm[] = [];
    for (const item of filtered) {
      if (item.categoryId === category.id || selectedIds.has(item.mappingId)) {
        assignedItems.push(item);
      } else if (item.categoryId === null) {
        availableItems.push(item);
      }
    }
    return {
      assigned: assignedItems.sort(sortTerms),
      available: availableItems.sort(sortTerms),
    };
  }, [search, selectedIds, items, category.id]);

  function toggle(mappingId: string, isChecked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (isChecked) next.add(mappingId);
      else next.delete(mappingId);
      return next;
    });
    setIsDirty(true);
  }

  async function save() {
    try {
      await saveMutation.mutateAsync({ categoryId: category.id, mappingIds: [...selectedIds] });
      setIsDirty(false);
      toast.success(t(locale, 'admin.publicCategories.shelves.saved'));
    } catch (error) {
      toast.error(formatPublicCategoriesApiError(error));
    }
  }

  function renderColumn(title: string, hint: string, listItems: GutenbergShelfTerm[], emptyKey: string) {
    return (
      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-surface-container-low/70 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>{title}</span>
          <span className="text-[11px] font-normal text-outline">{hint}</span>
        </div>
        {listItems.length === 0 ? (
          <p className="px-3 py-8 text-center text-[11px] text-outline">{t(locale, emptyKey)}</p>
        ) : (
          <div className="max-h-[26rem] divide-y divide-border/50 overflow-y-auto text-xs">
            {listItems.map((item) => {
              const isChecked = selectedIds.has(item.mappingId);
              return (
                <label
                  key={item.mappingId}
                  className="flex cursor-pointer items-center justify-between px-3 py-2.5 transition-colors hover:bg-background"
                >
                  <div className="flex min-w-0 items-center gap-2.5 pr-2">
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(value) => toggle(item.mappingId, value === true)}
                      aria-label={t(locale, 'admin.publicCategories.shelves.toggleAria', {
                        name: item.displayName,
                      })}
                      className="size-3.5 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                    />
                    <div className="min-w-0">
                      <div className={cn('truncate text-foreground', isChecked ? 'font-medium' : 'font-normal')}>
                        {item.displayName}
                      </div>
                      <div className="truncate font-mono text-[11px] text-outline">{item.sourceValue}</div>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 font-mono text-[11px]',
                      isChecked ? 'text-muted-foreground' : 'text-outline',
                    )}
                  >
                    {t(locale, 'admin.publicCategories.shelves.recordCount', {
                      count: item.recordCount.toLocaleString(),
                    })}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col justify-between gap-3 pt-1 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t(locale, 'admin.publicCategories.shelves.title')}</h3>
          <p className="mt-0.5 text-[11px] text-outline">{t(locale, 'admin.publicCategories.shelves.description')}</p>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-auto shrink-0 gap-1.5 rounded-lg px-3.5 py-1.5 text-xs"
          disabled={!isDirty || saveMutation.isPending}
          onClick={() => void save()}
        >
          {saveMutation.isPending ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <CheckIcon className="size-3.5" aria-hidden />
          )}
          {t(locale, 'admin.publicCategories.shelves.save')}
        </Button>
      </div>

      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-outline"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder={t(locale, 'admin.publicCategories.shelves.searchPlaceholder')}
          aria-label={t(locale, 'admin.publicCategories.shelves.searchPlaceholder')}
          className="h-auto rounded-lg border-border bg-card py-1.5 pr-3 pl-8 text-xs"
        />
      </div>

      <div className="mt-1 grid grid-cols-1 gap-4 md:grid-cols-2">
        {renderColumn(
          t(locale, 'admin.publicCategories.shelves.assignedTitleCount', { count: assigned.length }),
          t(locale, 'admin.publicCategories.shelves.uncheckToRemove'),
          assigned,
          'admin.publicCategories.shelves.assignedEmpty',
        )}
        {renderColumn(
          t(locale, 'admin.publicCategories.shelves.availableTitleCount', { count: available.length }),
          t(locale, 'admin.publicCategories.shelves.checkToInclude'),
          available,
          'admin.publicCategories.shelves.availableEmpty',
        )}
      </div>
    </div>
  );
}

export function CategoryShelfPanel({ category }: Props) {
  const { locale } = useLocale();
  const shelvesQuery = useGutenbergShelfTermsQuery();

  const initialSelectedIds = useMemo(() => {
    if (!shelvesQuery.data) return [];
    return shelvesQuery.data.items
      .filter((item) => item.categoryId === category.id)
      .map((item) => item.mappingId)
      .toSorted();
  }, [category.id, shelvesQuery.data]);

  if (shelvesQuery.isPending) {
    return <Skeleton className="h-64 rounded-xl" />;
  }

  if (shelvesQuery.isError) {
    return (
      <p className="rounded-lg border border-border px-4 py-6 text-xs text-destructive">
        {formatPublicCategoriesApiError(shelvesQuery.error) || t(locale, 'admin.publicCategories.shelves.loadFailed')}
      </p>
    );
  }

  return (
    <CategoryShelfEditor
      key={`${category.id}:${initialSelectedIds.join(',')}`}
      category={category}
      items={shelvesQuery.data.items}
      initialSelectedIds={initialSelectedIds}
    />
  );
}
