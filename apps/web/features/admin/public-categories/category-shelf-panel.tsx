'use client';

import { Loader2Icon, SaveIcon, SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import { type GutenbergShelfTerm, type PublicCategoryManagementItem } from '@gloaming/shared/discovery';

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

  function renderList(listItems: GutenbergShelfTerm[], emptyKey: string) {
    if (listItems.length === 0) {
      return (
        <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
          {t(locale, emptyKey)}
        </p>
      );
    }
    return (
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border border-border/60 p-2">
        {listItems.map((item) => {
          const isChecked = selectedIds.has(item.mappingId);
          return (
            <li key={item.mappingId} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
              <Checkbox
                checked={isChecked}
                onCheckedChange={(value) => toggle(item.mappingId, value === true)}
                aria-label={t(locale, 'admin.publicCategories.shelves.toggleAria', { name: item.displayName })}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.displayName}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{item.sourceValue}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t(locale, 'admin.publicCategories.shelves.recordCount', { count: item.recordCount })}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold tracking-tight">{t(locale, 'admin.publicCategories.shelves.title')}</h3>
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          disabled={!isDirty || saveMutation.isPending}
          onClick={() => void save()}
        >
          {saveMutation.isPending ? (
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
          ) : (
            <SaveIcon data-icon="inline-start" aria-hidden />
          )}
          {t(locale, 'admin.publicCategories.shelves.save')}
        </Button>
      </header>
      <p className="text-xs text-muted-foreground">{t(locale, 'admin.publicCategories.shelves.description')}</p>
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder={t(locale, 'admin.publicCategories.shelves.searchPlaceholder')}
          aria-label={t(locale, 'admin.publicCategories.shelves.searchPlaceholder')}
          className="h-8 pl-8"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t(locale, 'admin.publicCategories.shelves.assignedTitle')}
          </h4>
          {renderList(assigned, 'admin.publicCategories.shelves.assignedEmpty')}
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t(locale, 'admin.publicCategories.shelves.availableTitle')}
          </h4>
          {renderList(available, 'admin.publicCategories.shelves.availableEmpty')}
        </div>
      </div>
    </section>
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
    return <Skeleton className="h-64 rounded-2xl" />;
  }

  if (shelvesQuery.isError) {
    return (
      <p className="rounded-xl border border-border/60 px-4 py-6 text-sm text-destructive">
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
