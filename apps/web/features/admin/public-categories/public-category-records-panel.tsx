'use client';

import { PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import type { PublicCategoryManagementItem, SourceRecordItem } from '@gloaming/shared/discovery';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatPublicCategoriesApiError,
  isCategoryAssignmentLimitError,
  useAssignableSourceRecordsQuery,
  useAssignCategoryMutation,
  useCategorySourceRecordsQuery,
  useUnassignCategoryMutation,
} from '@/features/admin/public-categories/public-categories-api';
import {
  canAssignCategoryToRecord,
  isAssignmentSearchReady,
  isCategoryAssignedToRecord,
  PUBLIC_CATEGORY_RECORD_PAGE_SIZE,
  sourceRecordAuthorNames,
} from '@/features/admin/public-categories/public-categories-model';
import { useLocale } from '@/lib/locale-context';

/** Title plus identifying metadata shared by assigned and candidate rows. */
function RecordIdentity({ record }: { record: SourceRecordItem }) {
  const { locale } = useLocale();
  const authors = sourceRecordAuthorNames(record);
  const meta = [authors, record.sourceKey, record.languages?.join('/')].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{record.title}</p>
      <p className="truncate text-xs text-muted-foreground">{meta || record.externalId}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        <Badge variant="outline">
          {record.linkedWorkId
            ? t(locale, 'admin.publicCategories.records.linked')
            : t(locale, 'admin.publicCategories.records.notLinked')}
        </Badge>
        {record.availability === 'unavailable' ? (
          <Badge variant="destructive">{t(locale, 'admin.publicCategories.records.unavailable')}</Badge>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One category's assigned SourceRecords plus explicit, single-pair assignment and
 * removal. Search, pagination, and candidate discovery run against the admin
 * source-records endpoints, so candidates include records hidden from public
 * Discover (unavailable, disabled source, or non-English).
 */
export function PublicCategoryRecordsPanel({ category }: { category: PublicCategoryManagementItem }) {
  const { locale } = useLocale();
  const [recordSearchDraft, setRecordSearchDraft] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [page, setPage] = useState(1);
  const [candidateDraft, setCandidateDraft] = useState('');
  const [candidateTerm, setCandidateTerm] = useState('');
  const [removing, setRemoving] = useState<SourceRecordItem | null>(null);

  const recordsQuery = useCategorySourceRecordsQuery(category.id, {
    page,
    pageSize: PUBLIC_CATEGORY_RECORD_PAGE_SIZE,
    q: recordSearch || undefined,
  });
  const candidatesQuery = useAssignableSourceRecordsQuery(candidateTerm);
  const assignMutation = useAssignCategoryMutation();
  const unassignMutation = useUnassignCategoryMutation();
  const pagination = recordsQuery.data?.pagination;
  const records = recordsQuery.data?.items ?? [];
  const candidates = candidatesQuery.data?.items ?? [];

  function submitRecordSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setRecordSearch(recordSearchDraft.trim());
  }

  function submitCandidateSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCandidateTerm(candidateDraft.trim());
  }

  async function assign(record: SourceRecordItem) {
    try {
      await assignMutation.mutateAsync({ sourceRecordId: record.sourceRecordId, categoryId: category.id });
      toast.success(t(locale, 'admin.publicCategories.records.assignedToast'));
    } catch (error) {
      toast.error(
        isCategoryAssignmentLimitError(error)
          ? t(locale, 'admin.publicCategories.records.assignmentLimit')
          : formatPublicCategoriesApiError(error),
      );
    }
  }

  async function remove() {
    if (!removing) {
      return;
    }
    try {
      await unassignMutation.mutateAsync({ sourceRecordId: removing.sourceRecordId, categoryId: category.id });
      setRemoving(null);
      toast.success(t(locale, 'admin.publicCategories.records.removedToast'));
    } catch (error) {
      toast.error(formatPublicCategoriesApiError(error));
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-sm font-medium">{t(locale, 'admin.publicCategories.records.title')}</h2>
        <form role="search" className="flex w-full items-center gap-2 sm:w-72" onSubmit={submitRecordSearch}>
          <div className="relative flex-1">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={recordSearchDraft}
              onChange={(event) => setRecordSearchDraft(event.currentTarget.value)}
              placeholder={t(locale, 'admin.publicCategories.records.searchPlaceholder')}
              aria-label={t(locale, 'admin.publicCategories.records.searchPlaceholder')}
              className="h-8 pl-8"
            />
          </div>
          <Button type="submit" variant="outline" size="sm" className="shrink-0">
            {t(locale, 'content.discover.searchAction')}
          </Button>
        </form>
      </div>

      {recordsQuery.isPending ? (
        <div className="mt-3 flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : recordsQuery.isError ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {formatPublicCategoriesApiError(recordsQuery.error) || t(locale, 'admin.publicCategories.errors.loadRecords')}
        </p>
      ) : records.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {recordSearch
            ? t(locale, 'admin.publicCategories.records.noMatch')
            : t(locale, 'admin.publicCategories.records.empty')}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border/60">
          {records.map((record) => (
            <li key={record.sourceRecordId} className="flex items-center gap-3 py-3">
              <RecordIdentity record={record} />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={t(locale, 'admin.publicCategories.records.removeAria', { title: record.title })}
                disabled={unassignMutation.isPending}
                onClick={() => setRemoving(record)}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {pagination && pagination.totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-between gap-3">
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

      <div className="mt-5 border-t border-border pt-4">
        <h3 className="text-sm font-medium">{t(locale, 'admin.publicCategories.assign.title')}</h3>
        <form role="search" className="mt-2 flex items-center gap-2" onSubmit={submitCandidateSearch}>
          <Input
            type="search"
            value={candidateDraft}
            onChange={(event) => setCandidateDraft(event.currentTarget.value)}
            placeholder={t(locale, 'admin.publicCategories.assign.searchPlaceholder')}
            aria-label={t(locale, 'admin.publicCategories.assign.searchPlaceholder')}
            className="h-8"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={!isAssignmentSearchReady(candidateDraft)}
          >
            {t(locale, 'content.discover.searchAction')}
          </Button>
        </form>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t(locale, 'admin.publicCategories.assign.hint')}{' '}
          {t(locale, 'admin.publicCategories.assign.includesHiddenHint')}
        </p>

        {!isAssignmentSearchReady(candidateTerm) ? null : candidatesQuery.isPending ? (
          <div className="mt-2 flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-12 rounded-xl" />
          </div>
        ) : candidatesQuery.isError ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {formatPublicCategoriesApiError(candidatesQuery.error) ||
              t(locale, 'admin.publicCategories.errors.searchRecords')}
          </p>
        ) : candidates.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t(locale, 'admin.publicCategories.assign.noResults')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border/60">
            {candidates.map((record) => {
              const isAssigned = isCategoryAssignedToRecord(record, category.id);
              return (
                <li key={record.sourceRecordId} className="flex items-center gap-3 py-2.5">
                  <RecordIdentity record={record} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    aria-label={t(locale, 'admin.publicCategories.records.assignAria', { title: record.title })}
                    disabled={isAssigned || !canAssignCategoryToRecord(record, category.id) || assignMutation.isPending}
                    onClick={() => void assign(record)}
                  >
                    <PlusIcon data-icon="inline-start" aria-hidden />
                    {isAssigned
                      ? t(locale, 'admin.publicCategories.records.assigned')
                      : t(locale, 'admin.publicCategories.records.assign')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(locale, 'admin.publicCategories.records.removeConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(locale, 'admin.publicCategories.records.removeConfirmDescription', {
                title: removing?.title ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unassignMutation.isPending}>
              {t(locale, 'admin.publicCategories.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={unassignMutation.isPending}
              onClick={() => void remove()}
            >
              {t(locale, 'admin.publicCategories.records.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
