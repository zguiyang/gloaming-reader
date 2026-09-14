'use client';

import { Eye, FileText, MoreHorizontal, PencilLine, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import { WORK_STATUSES, type WorkStatus } from '@gloaming/shared/works';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { ADMIN_ROUTES } from '@/constants';
import { AdminSegmentedTabsList, AdminSegmentedTabsTrigger } from '@/features/admin/admin-segmented-tabs';
import {
  deleteAdminWork,
  formatWorksApiError,
  publishAdminWork,
  retryAdminWorkflow,
  unpublishAdminWork,
  useAdminWorksListQuery,
  useInvalidateAdminWorks,
} from '@/features/admin/works/works-api';
import { formatWorkStatus, formatWorkUpdatedAt } from '@/features/admin/works/works-format';
import type { AdminWorkSummaryView } from '@/features/admin/works/works-model';
import { useLocale } from '@/lib/locale-context';

type StatusFilter = WorkStatus | 'all' | 'busy';

/** Running + idle-wait statuses grouped as one list tab. */
const BUSY_STATUSES = ['uploaded', 'processing', 'parsed', 'metadata', 'tts'] as const;

type WorkRowActionsProps = {
  work: AdminWorkSummaryView;
  onPublish: (id: string) => void;
  onUnpublish: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
};

/** Row actions: one status-primary action inline + the rest in a 「更多」 menu. */
function WorkRowActions({ work, onPublish, onUnpublish, onRetry, onDelete }: WorkRowActionsProps) {
  const { locale } = useLocale();
  const router = useRouter();
  const canPreview =
    work.partCount > 0 &&
    work.status !== 'processing' &&
    work.status !== 'metadata' &&
    work.status !== 'uploaded' &&
    work.status !== 'failed';

  return (
    <div className="flex justify-end gap-2">
      {work.status === 'ready' ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => onPublish(work.id)}>
          {t(locale, 'admin.content.common.publish')}
        </Button>
      ) : null}
      {work.status === 'published' ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onUnpublish(work.id)}>
          {t(locale, 'admin.content.common.unpublish')}
        </Button>
      ) : null}
      {work.status === 'failed' ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => onRetry(work.id)}>
          {t(locale, 'content.common.retry')}
        </Button>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t(locale, 'admin.works.list.moreActionsAria', { title: work.title })}
            />
          }
        >
          <MoreHorizontal data-icon="inline-start" />
          {t(locale, 'admin.content.common.more')}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => router.push(ADMIN_ROUTES.workDetail(work.id))}>
            <PencilLine />
            {t(locale, 'admin.works.list.editWork')}
          </DropdownMenuItem>
          {canPreview ? (
            <DropdownMenuItem onClick={() => router.push(ADMIN_ROUTES.workPreview(work.id))}>
              <Eye />
              {t(locale, 'admin.works.list.preview')}
            </DropdownMenuItem>
          ) : null}
          {work.status !== 'published' ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(work.id)}>
                <Trash2 />
                {t(locale, 'admin.content.common.delete')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function WorksTableSkeleton({ rows }: { rows: number }) {
  const { locale } = useLocale();

  return (
    <Table aria-hidden>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
            {t(locale, 'admin.works.list.tableTitle')}
          </TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
            {t(locale, 'admin.works.list.tableAuthor')}
          </TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
            {t(locale, 'admin.works.list.tableStatus')}
          </TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
            {t(locale, 'admin.works.list.tableChapters')}
          </TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
            {t(locale, 'admin.works.list.tableUpdated')}
          </TableHead>
          <TableHead className="h-12 w-[1%] bg-surface-container-low px-5 text-right text-muted-foreground">
            {t(locale, 'admin.content.common.actions')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }, (_, index) => (
          <TableRow key={index} className="border-border hover:bg-transparent">
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-40 max-w-full bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-16 bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-5 w-12 rounded-full bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-8 bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-24 bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4 text-right">
              <Skeleton className="ml-auto h-7 w-24 rounded-xl bg-muted/70" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function WorksListPage() {
  const { locale } = useLocale();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const invalidate = useInvalidateAdminWorks();
  const listQuery = useAdminWorksListQuery(
    statusFilter === 'all'
      ? {}
      : statusFilter === 'busy'
        ? { status: BUSY_STATUSES.join(',') }
        : { status: statusFilter },
  );

  const statusFilters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: t(locale, 'admin.works.filter.all') },
    { value: 'busy', label: t(locale, 'admin.works.filter.busy') },
    { value: 'ready', label: t(locale, 'admin.works.filter.ready') },
    { value: 'failed', label: t(locale, 'admin.works.filter.failed') },
    { value: 'published', label: t(locale, 'admin.works.filter.published') },
  ];

  async function handlePublish(id: string) {
    try {
      await publishAdminWork(id);
      await invalidate(id);
      toast.success(t(locale, 'admin.content.common.published'));
    } catch (error) {
      toast.error(formatWorksApiError(error));
    }
  }

  async function handleUnpublish(id: string) {
    try {
      await unpublishAdminWork(id);
      await invalidate(id);
      toast.success(t(locale, 'admin.content.common.unpublished'));
    } catch (error) {
      toast.error(formatWorksApiError(error));
    }
  }

  async function handleRetry(id: string) {
    try {
      await retryAdminWorkflow(id);
      await invalidate(id);
      toast.success(t(locale, 'admin.works.list.retryStarted'));
    } catch (error) {
      toast.error(formatWorksApiError(error));
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t(locale, 'admin.content.common.confirmDeleteWork'))) return;
    try {
      await deleteAdminWork(id);
      await invalidate();
      toast.success(t(locale, 'admin.content.common.deleted'));
    } catch (error) {
      toast.error(formatWorksApiError(error));
    }
  }

  const items = listQuery.data?.items ?? [];

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto w-full max-w-6xl">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">{t(locale, 'admin.works.list.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t(locale, 'admin.works.list.subtitle')}</p>
        </div>
        <Button
          nativeButton={false}
          className="h-10 rounded-xl px-6 hover:bg-brand-deep"
          render={<Link href={ADMIN_ROUTES.workNew} />}
        >
          {t(locale, 'admin.works.list.upload')}
        </Button>
      </div>

      <div className="mb-6 w-fit">
        <Tabs
          value={statusFilter}
          onValueChange={(value) => {
            if (value === 'all' || value === 'busy' || (WORK_STATUSES as readonly string[]).includes(value)) {
              setStatusFilter(value as StatusFilter);
            }
          }}
        >
          <AdminSegmentedTabsList aria-label={t(locale, 'admin.works.list.filterAria')}>
            {statusFilters.map((item) => (
              <AdminSegmentedTabsTrigger key={item.value} value={item.value}>
                {item.label}
              </AdminSegmentedTabsTrigger>
            ))}
          </AdminSegmentedTabsList>
        </Tabs>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {listQuery.isPending ? (
          <WorksTableSkeleton rows={4} />
        ) : listQuery.isError && !listQuery.data ? (
          <Empty className="border-0 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText />
              </EmptyMedia>
              <EmptyTitle>{t(locale, 'admin.works.list.loadFailed')}</EmptyTitle>
              <EmptyDescription>{formatWorksApiError(listQuery.error)}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : items.length === 0 ? (
          <Empty className="border-0 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText />
              </EmptyMedia>
              <EmptyTitle>{t(locale, 'admin.works.list.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t(locale, 'admin.works.list.emptyDescription')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                  {t(locale, 'admin.works.list.tableTitle')}
                </TableHead>
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                  {t(locale, 'admin.works.list.tableAuthor')}
                </TableHead>
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                  {t(locale, 'admin.works.list.tableStatus')}
                </TableHead>
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                  {t(locale, 'admin.works.list.tableChapters')}
                </TableHead>
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                  {t(locale, 'admin.works.list.tableUpdated')}
                </TableHead>
                <TableHead className="h-12 w-[1%] bg-surface-container-low px-5 text-right text-muted-foreground">
                  {t(locale, 'admin.content.common.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((work) => (
                <TableRow
                  key={work.id}
                  className="border-border transition-colors duration-300 ease-out-soft hover:bg-muted/60"
                >
                  <TableCell className="px-5 py-4">
                    <Link
                      href={ADMIN_ROUTES.workDetail(work.id)}
                      className="font-medium underline-offset-4 transition-colors hover:text-brand-deep hover:underline"
                    >
                      {work.title}
                    </Link>
                  </TableCell>
                  <TableCell className="px-5 py-4 text-muted-foreground">{work.author || '—'}</TableCell>
                  <TableCell className="px-5 py-4">
                    <Badge
                      variant={
                        work.status === 'failed' ? 'destructive' : work.status === 'ready' ? 'secondary' : 'outline'
                      }
                    >
                      {formatWorkStatus(work.status, locale)}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-5 py-4 text-muted-foreground">
                    {work.originKind === 'admin_epub' ? work.partCount : '—'}
                  </TableCell>
                  <TableCell className="px-5 py-4 text-muted-foreground">
                    {formatWorkUpdatedAt(work.updatedAt, locale)}
                  </TableCell>
                  <TableCell className="px-5 py-4 text-right">
                    <WorkRowActions
                      work={work}
                      onPublish={(id) => void handlePublish(id)}
                      onUnpublish={(id) => void handleUnpublish(id)}
                      onRetry={(id) => void handleRetry(id)}
                      onDelete={(id) => void handleDelete(id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
