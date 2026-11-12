'use client';

import { PlusIcon, SearchIcon } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { type Locale, SUPPORTED_LOCALES, t } from '@/i18n';
import { PUBLIC_CATEGORY_NAME_MAX_CHARS } from '@/shared/discovery';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { CategoryShelfPanel } from '@/features/admin/public-categories/category-shelf-panel';
import {
  formatPublicCategoriesApiError,
  isCategoryNameCollisionError,
  useCreateManagedCategoryMutation,
  useDeleteManagedCategoryMutation,
  useManagedCategoriesQuery,
} from '@/features/admin/public-categories/public-categories-api';
import {
  categoryDisplayName,
  filterPublicCategories,
  localeDisplayLabel,
  paginatePublicCategories,
  PUBLIC_CATEGORY_ADMIN_PAGE_SIZE,
  sortPublicCategories,
} from '@/features/admin/public-categories/public-categories-model';
import { PublicCategoryLabelsEditor } from '@/features/admin/public-categories/public-category-labels-editor';
import { ShelfOrganizationPanel } from '@/features/admin/public-categories/shelf-organization-panel';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

export function PublicCategoriesPage() {
  const { locale } = useLocale();
  const categoriesQuery = useManagedCategoriesQuery();
  const createMutation = useCreateManagedCategoryMutation();
  const deleteMutation = useDeleteManagedCategoryMutation();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditingLabels, setIsEditingLabels] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLocale, setNewLocale] = useState<Locale>(locale);

  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const sorted = useMemo(() => sortPublicCategories(categories, locale), [categories, locale]);
  const filtered = useMemo(() => filterPublicCategories(sorted, locale, search), [sorted, locale, search]);
  const { items: pageItems, pagination } = paginatePublicCategories(filtered, page, PUBLIC_CATEGORY_ADMIN_PAGE_SIZE);
  const selected = selectedId ? (categories.find((category) => category.id === selectedId) ?? null) : null;
  const localeItems = SUPPORTED_LOCALES.map((value) => ({ value, label: localeDisplayLabel(value, locale) }));

  function selectCategory(categoryId: string) {
    setSelectedId(categoryId);
    setIsEditingLabels(false);
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const category = await createMutation.mutateAsync({ name, locale: newLocale });
      setNewName('');
      setSearch('');
      setPage(1);
      setIsCreating(false);
      setIsEditingLabels(false);
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

  async function removeCategory() {
    if (!selected) return;
    try {
      await deleteMutation.mutateAsync(selected.id);
      setIsDeleting(false);
      setSelectedId(null);
      toast.success(t(locale, 'admin.publicCategories.delete.deletedToast'));
    } catch (error) {
      setIsDeleting(false);
      toast.error(formatPublicCategoriesApiError(error));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-col justify-between gap-4 border-b border-border/70 pb-2 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
            {t(locale, 'admin.publicCategories.page.title')}
          </h1>
          <p className="mt-1 text-xs font-normal text-outline">{t(locale, 'admin.publicCategories.page.subtitle')}</p>
        </div>
        <ShelfOrganizationPanel />
      </header>

      {categoriesQuery.isPending ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12" aria-busy="true">
          <Skeleton className="h-80 rounded-xl lg:col-span-4" />
          <Skeleton className="h-80 rounded-xl lg:col-span-8" />
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
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          <aside className="flex flex-col gap-3 rounded-xl border border-border bg-surface-container-low p-3.5 lg:col-span-4">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <SearchIcon
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-outline"
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
                  className="h-auto rounded-lg border-border bg-card py-1.5 pr-2.5 pl-8 text-xs"
                />
              </div>
              <button
                type="button"
                className="flex h-[30px] shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                aria-expanded={isCreating}
                onClick={() => setIsCreating((current) => !current)}
              >
                <PlusIcon className="size-3" aria-hidden />
                <span>{t(locale, 'admin.publicCategories.create.new')}</span>
              </button>
            </div>

            {isCreating ? (
              <form
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5 text-xs"
                onSubmit={createCategory}
              >
                <span className="font-medium text-muted-foreground">
                  {t(locale, 'admin.publicCategories.create.formTitle')}
                </span>
                <div className="flex gap-2">
                  <Input
                    value={newName}
                    maxLength={PUBLIC_CATEGORY_NAME_MAX_CHARS}
                    onChange={(event) => setNewName(event.currentTarget.value)}
                    placeholder={t(locale, 'admin.publicCategories.create.namePlaceholder')}
                    aria-label={t(locale, 'admin.publicCategories.create.namePlaceholder')}
                    disabled={createMutation.isPending}
                    className="h-7 flex-1 rounded border-border bg-background px-2.5 text-xs"
                    autoFocus
                  />
                  <Select
                    items={localeItems}
                    value={newLocale}
                    onValueChange={(value) => value && setNewLocale(value as Locale)}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-7 w-auto text-xs"
                      aria-label={t(locale, 'admin.publicCategories.create.localeLabel')}
                    >
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
                    variant="outline"
                    className="h-7 px-2.5 text-xs text-primary"
                    disabled={!newName.trim() || createMutation.isPending}
                  >
                    {t(locale, 'admin.publicCategories.create.confirm')}
                  </Button>
                </div>
              </form>
            ) : null}

            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-outline">
                {search
                  ? t(locale, 'admin.publicCategories.search.empty')
                  : t(locale, 'admin.publicCategories.list.empty')}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border/40">
                {pageItems.map((category) => {
                  const isActive = category.id === selectedId;
                  return (
                    <li key={category.id}>
                      <button
                        type="button"
                        aria-current={isActive ? 'true' : undefined}
                        aria-pressed={isActive}
                        onClick={() => selectCategory(category.id)}
                        className={cn(
                          'group relative flex w-full cursor-pointer items-center justify-between px-3 py-2.5 text-left transition-colors',
                          isActive ? 'bg-background' : 'rounded-lg hover:bg-card/60',
                        )}
                      >
                        {isActive ? (
                          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-primary" />
                        ) : null}
                        <span
                          className={cn(
                            'text-xs',
                            isActive
                              ? 'font-semibold text-foreground'
                              : 'font-medium text-foreground group-hover:text-primary',
                          )}
                        >
                          {categoryDisplayName(category, locale)}
                        </span>
                        <span
                          className={cn(
                            'font-mono text-[11px]',
                            isActive ? 'font-medium text-primary' : 'text-outline',
                          )}
                        >
                          {category.recordCount.toLocaleString()}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {pagination.totalPages > 1 ? (
              <div className="flex items-center justify-between border-t border-border/70 pt-2 text-[11px] text-outline">
                <span>
                  {t(locale, 'admin.publicCategories.pagination.page', {
                    page: pagination.page,
                    total: pagination.totalPages,
                  })}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={pagination.page <= 1}
                    className="cursor-pointer rounded border border-border bg-card px-2 py-0.5 text-muted-foreground hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    {t(locale, 'admin.publicCategories.pagination.prev')}
                  </button>
                  <button
                    type="button"
                    disabled={pagination.page >= pagination.totalPages}
                    className="cursor-pointer rounded border border-border bg-card px-2 py-0.5 text-muted-foreground hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {t(locale, 'admin.publicCategories.pagination.next')}
                  </button>
                </div>
              </div>
            ) : null}
          </aside>

          {selected ? (
            <section className="flex flex-col gap-5 rounded-xl border border-border bg-surface-container-low p-5 lg:col-span-8">
              <div className="flex items-center justify-between border-b border-border/70 pb-3.5">
                <div className="flex items-baseline gap-2.5">
                  <h2 className="font-heading text-xl font-semibold text-foreground">
                    {categoryDisplayName(selected, locale)}
                  </h2>
                  <span className="font-mono text-xs text-outline">
                    {t(locale, 'admin.publicCategories.recordCount', {
                      count: selected.recordCount.toLocaleString(),
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    className="cursor-pointer text-muted-foreground transition-colors hover:text-primary"
                    onClick={() => setIsEditingLabels(true)}
                  >
                    {t(locale, 'admin.publicCategories.labels.edit')}
                  </button>
                  <span className="text-border" aria-hidden>
                    |
                  </span>
                  <button
                    type="button"
                    className="cursor-pointer text-outline transition-colors hover:text-destructive"
                    disabled={deleteMutation.isPending}
                    title={t(locale, 'admin.publicCategories.delete.action')}
                    onClick={() => setIsDeleting(true)}
                  >
                    {t(locale, 'admin.publicCategories.delete.action')}
                  </button>
                </div>
              </div>

              <PublicCategoryLabelsEditor
                key={`labels-${selected.id}`}
                category={selected}
                isEditing={isEditingLabels}
                onEditingChange={setIsEditingLabels}
              />
              <CategoryShelfPanel key={`shelves-${selected.id}`} category={selected} />

              <AlertDialog open={isDeleting} onOpenChange={setIsDeleting}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t(locale, 'admin.publicCategories.delete.confirmTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t(locale, 'admin.publicCategories.delete.confirmDescription', {
                        name: categoryDisplayName(selected, locale),
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleteMutation.isPending}>
                      {t(locale, 'admin.publicCategories.cancel')}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={deleteMutation.isPending}
                      onClick={() => void removeCategory()}
                    >
                      {t(locale, 'admin.publicCategories.delete.confirm')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </section>
          ) : (
            <p className="rounded-xl border border-border bg-surface-container-low px-4 py-10 text-center text-xs text-outline lg:col-span-8">
              {t(locale, 'admin.publicCategories.list.selectHint')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
