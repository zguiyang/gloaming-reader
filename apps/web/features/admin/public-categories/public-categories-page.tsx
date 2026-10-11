'use client';

import { PlusIcon, SearchIcon } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { type Locale, SUPPORTED_LOCALES, t } from '@gloaming/i18n';
import { PUBLIC_CATEGORY_NAME_MAX_CHARS } from '@gloaming/shared/discovery';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatPublicCategoriesApiError,
  isCategoryNameCollisionError,
  useCreateManagedCategoryMutation,
  useManagedCategoriesQuery,
} from '@/features/admin/public-categories/public-categories-api';
import {
  categoryDisplayName,
  categoryProvenanceKey,
  filterPublicCategories,
  isCategoryFullyLocalized,
  localeDisplayLabel,
  paginatePublicCategories,
  PUBLIC_CATEGORY_ADMIN_PAGE_SIZE,
  sortPublicCategories,
} from '@/features/admin/public-categories/public-categories-model';
import { PublicCategoryLabelsEditor } from '@/features/admin/public-categories/public-category-labels-editor';
import { PublicCategoryRecordsPanel } from '@/features/admin/public-categories/public-category-records-panel';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

/**
 * Instance-level Public Category management. Manual creation and localized label
 * edits never require an AI Provider; the optional AI translation action is
 * deferred until PC-03 is integrated. Assignment/removal are explicit, single
 * record/category actions against the existing PC-02 admin endpoints.
 */
export function PublicCategoriesPage() {
  const { locale } = useLocale();
  const categoriesQuery = useManagedCategoriesQuery();
  const createMutation = useCreateManagedCategoryMutation();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newLocale, setNewLocale] = useState<Locale>(locale);

  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const sorted = useMemo(() => sortPublicCategories(categories, locale), [categories, locale]);
  const filtered = useMemo(() => filterPublicCategories(sorted, locale, search), [sorted, locale, search]);
  const { items: pageItems, pagination } = paginatePublicCategories(filtered, page, PUBLIC_CATEGORY_ADMIN_PAGE_SIZE);
  const selected = selectedId ? (categories.find((category) => category.id === selectedId) ?? null) : null;
  const localeItems = SUPPORTED_LOCALES.map((value) => ({ value, label: localeDisplayLabel(value, locale) }));

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      return;
    }
    try {
      // The stable id always comes from the POST response, including when the
      // service reuses an existing category with the same normalized label.
      const category = await createMutation.mutateAsync({ name, locale: newLocale });
      setNewName('');
      setSearch('');
      setPage(1);
      setSelectedId(category.id);
      toast.success(t(locale, 'admin.publicCategories.create.ready'));
    } catch (error) {
      toast.error(
        isCategoryNameCollisionError(error)
          ? t(locale, 'admin.publicCategories.labels.nameExists')
          : formatPublicCategoriesApiError(error),
      );
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t(locale, 'admin.publicCategories.page.title')}</h1>
        <p className="text-sm text-muted-foreground">{t(locale, 'admin.publicCategories.page.subtitle')}</p>
      </header>

      {categoriesQuery.isPending ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]" aria-busy="true">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : categoriesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t(locale, 'admin.publicCategories.errors.operationFailed')}</AlertTitle>
          <AlertDescription>
            {formatPublicCategoriesApiError(categoriesQuery.error) ||
              t(locale, 'admin.publicCategories.errors.loadCategories')}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <section className="flex min-w-0 flex-col gap-3">
            <form className="flex items-center gap-2" onSubmit={createCategory}>
              <Input
                value={newName}
                maxLength={PUBLIC_CATEGORY_NAME_MAX_CHARS}
                onChange={(event) => setNewName(event.currentTarget.value)}
                placeholder={t(locale, 'admin.publicCategories.create.namePlaceholder')}
                aria-label={t(locale, 'admin.publicCategories.create.namePlaceholder')}
                disabled={createMutation.isPending}
                className="h-8"
              />
              <Select
                items={localeItems}
                value={newLocale}
                onValueChange={(value) => value && setNewLocale(value as Locale)}
              >
                <SelectTrigger size="sm" aria-label={t(locale, 'admin.publicCategories.create.localeLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {localeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                type="submit"
                size="sm"
                className="shrink-0"
                disabled={!newName.trim() || createMutation.isPending}
              >
                <PlusIcon data-icon="inline-start" aria-hidden />
                {t(locale, 'admin.publicCategories.create.submit')}
              </Button>
            </form>

            <div className="relative">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.currentTarget.value);
                  setPage(1);
                }}
                placeholder={t(locale, 'admin.publicCategories.search.placeholder')}
                aria-label={t(locale, 'admin.publicCategories.search.placeholder')}
                className="h-8 pl-8"
              />
            </div>

            {filtered.length === 0 ? (
              <p className="rounded-xl border border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                {search
                  ? t(locale, 'admin.publicCategories.search.empty')
                  : t(locale, 'admin.publicCategories.list.empty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {pageItems.map((category) => {
                  const isActive = category.id === selectedId;
                  return (
                    <li key={category.id}>
                      <button
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => setSelectedId(category.id)}
                        className={cn(
                          'flex w-full flex-col gap-1 rounded-xl px-3 py-2 text-left transition-colors duration-200 ease-out-soft',
                          'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-medium">
                            {categoryDisplayName(category, locale)}
                          </span>
                          <Badge variant="outline">
                            {t(locale, 'admin.publicCategories.recordCount', { count: category.recordCount })}
                          </Badge>
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>{t(locale, categoryProvenanceKey(category.createdBy))}</span>
                          {!isCategoryFullyLocalized(category) ? (
                            <Badge variant="outline">{t(locale, 'admin.publicCategories.labels.untranslated')}</Badge>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {pagination.totalPages > 1 ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {t(locale, 'admin.publicCategories.pagination.page', {
                    page: pagination.page,
                    total: pagination.totalPages,
                  })}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pagination.page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    {t(locale, 'admin.publicCategories.pagination.prev')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {t(locale, 'admin.publicCategories.pagination.next')}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          {selected ? (
            <div className="flex min-w-0 flex-col gap-4">
              <header className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">{categoryDisplayName(selected, locale)}</h2>
                  <Badge variant="outline">{t(locale, categoryProvenanceKey(selected.createdBy))}</Badge>
                  <Badge variant="outline">
                    {t(locale, 'admin.publicCategories.recordCount', { count: selected.recordCount })}
                  </Badge>
                </div>
                <p className="font-mono text-xs text-muted-foreground">
                  {t(locale, 'admin.publicCategories.detail.idLabel')}: {selected.id}
                </p>
                {selected.meaning ? (
                  <p className="text-xs text-muted-foreground">
                    {t(locale, 'admin.publicCategories.detail.meaning')}: {selected.meaning}
                  </p>
                ) : null}
                {selected.manualLocales?.length ? (
                  <p className="text-xs text-muted-foreground">
                    {t(locale, 'admin.publicCategories.detail.manualLocales', {
                      locales: selected.manualLocales.map((tag) => localeDisplayLabel(tag, locale)).join(' / '),
                    })}
                  </p>
                ) : null}
              </header>
              <PublicCategoryLabelsEditor key={`labels-${selected.id}`} category={selected} />
              <PublicCategoryRecordsPanel key={`records-${selected.id}`} category={selected} />
            </div>
          ) : (
            <p className="self-start rounded-2xl border border-border/60 px-4 py-6 text-sm text-muted-foreground">
              {t(locale, 'admin.publicCategories.list.selectHint')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
