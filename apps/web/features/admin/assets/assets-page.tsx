'use client';

import { HardDrive, RefreshCw } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { t } from '@gloaming/i18n';
import type { AssetCleanupJobStatus, AssetObjectListQuery, AssetScanReport } from '@gloaming/shared/assets';
import { ASSET_OBJECT_DEFAULT_PAGE_SIZE, DEFAULT_ASSET_OBJECT_SORT_BY } from '@gloaming/shared/assets';
import { DEFAULT_PAGE, DEFAULT_SORT_ORDER } from '@gloaming/shared/pagination';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  formatAssetsApiError,
  useCleanupJobQuery,
  useEnqueueOrphanCleanupMutation,
  useRetryCleanupJobMutation,
  useScanAssetsMutation,
} from '@/features/admin/assets/assets-api';
import { AssetsCleanupCard } from '@/features/admin/assets/assets-cleanup-card';
import { AssetsCleanupDialog } from '@/features/admin/assets/assets-cleanup-dialog';
import {
  clearStoredCleanupJob,
  deriveAssetsPageStatus,
  getStoredCleanupJobId,
  shouldRefreshScanAfterCleanupTransition,
  subscribeStoredCleanupJob,
  writeStoredCleanupJob,
} from '@/features/admin/assets/assets-cleanup-state';
import { formatDurationMs, formatMeasuredAt, formatStorageBytes } from '@/features/admin/assets/assets-format';
import { AssetsLargestList } from '@/features/admin/assets/assets-largest-list';
import { AssetsObjectTable } from '@/features/admin/assets/assets-object-table';
import { AssetsSummary } from '@/features/admin/assets/assets-summary';
import { useLocale } from '@/lib/locale-context';

const AssetsChart = dynamic(() => import('@/features/admin/assets/assets-chart').then((module) => module.AssetsChart), {
  ssr: false,
  loading: () => (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className="mx-auto h-56 w-56 rounded-full" />
      </CardContent>
    </Card>
  ),
});

const INITIAL_OBJECT_QUERY: AssetObjectListQuery = {
  page: DEFAULT_PAGE,
  pageSize: ASSET_OBJECT_DEFAULT_PAGE_SIZE,
  sortBy: DEFAULT_ASSET_OBJECT_SORT_BY,
  sortOrder: DEFAULT_SORT_ORDER,
  status: 'all',
  category: 'all',
};

export function AssetsPage() {
  const { locale } = useLocale();
  const scanMutation = useScanAssetsMutation();
  const enqueueMutation = useEnqueueOrphanCleanupMutation();
  const retryMutation = useRetryCleanupJobMutation();
  const [report, setReport] = useState<AssetScanReport | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isCleanupOpen, setIsCleanupOpen] = useState(false);
  const [objectQuery, setObjectQuery] = useState<AssetObjectListQuery>(INITIAL_OBJECT_QUERY);
  const jobId = useSyncExternalStore(subscribeStoredCleanupJob, getStoredCleanupJobId, () => null);
  const previousJobStatusRef = useRef<AssetCleanupJobStatus | undefined>(undefined);

  const jobQuery = useCleanupJobQuery(jobId);
  const job = jobQuery.data ?? null;
  const isScanning = scanMutation.isPending;
  const hasReport = report !== null;
  const pageStatus = deriveAssetsPageStatus({ isScanning, hasReport, job });
  const hasJobForCurrentScan = Boolean(report && job && job.scanId === report.scanId);
  const canOpenCleanup =
    Boolean(report?.scanComplete) &&
    (report?.orphanCount ?? 0) > 0 &&
    !hasJobForCurrentScan &&
    !enqueueMutation.isPending;

  useEffect(() => {
    if (!jobQuery.isError) return;
    clearStoredCleanupJob();
  }, [jobQuery.isError]);

  async function runScan() {
    setScanError(null);
    try {
      const next = await scanMutation.mutateAsync();
      setReport(next);
      setObjectQuery(INITIAL_OBJECT_QUERY);
    } catch (error) {
      setScanError(formatAssetsApiError(error) || t(locale, 'admin.assets.page.scanStorageFailed'));
    }
  }

  useEffect(() => {
    const status = job?.status;
    const previous = previousJobStatusRef.current;
    previousJobStatusRef.current = status;
    if (!shouldRefreshScanAfterCleanupTransition(previous, status)) return;
    void runScan();
    // Refresh the scan snapshot only when an in-flight job reaches a terminal status.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depends on job status transitions
  }, [job]);

  async function enqueueCleanup() {
    if (!report) return;
    setIsCleanupOpen(false);
    setScanError(null);
    try {
      const accepted = await enqueueMutation.mutateAsync(report.scanId);
      writeStoredCleanupJob({ jobId: accepted.jobId, scanId: accepted.scanId });
    } catch (error) {
      setScanError(formatAssetsApiError(error) || t(locale, 'admin.assets.page.cleanupEnqueueFailed'));
    }
  }

  async function retryCleanup() {
    if (!job) return;
    setScanError(null);
    try {
      const accepted = await retryMutation.mutateAsync(job.jobId);
      writeStoredCleanupJob({ jobId: accepted.jobId, scanId: accepted.scanId });
    } catch (error) {
      setScanError(formatAssetsApiError(error) || t(locale, 'admin.assets.page.cleanupRetryFailed'));
    }
  }

  return (
    <div className="flex flex-col gap-6" data-page-status={pageStatus}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t(locale, 'admin.assets.page.title')}</h1>
          <p className="text-muted-foreground text-sm">{t(locale, 'admin.assets.page.subtitle')}</p>
          {report ? (
            <p className="text-muted-foreground text-sm">
              {t(locale, 'admin.assets.page.lastScan', {
                time: formatMeasuredAt(report.measuredAt, locale),
                status: report.scanComplete
                  ? t(locale, 'admin.assets.page.scanComplete')
                  : t(locale, 'admin.assets.page.scanIncomplete'),
                duration: formatDurationMs(report.durationMs, locale),
              })}
            </p>
          ) : null}
        </div>
        <Button onClick={() => void runScan()} disabled={isScanning}>
          {isScanning ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
          {isScanning ? t(locale, 'admin.assets.page.scanning') : t(locale, 'admin.assets.page.scanNow')}
        </Button>
      </div>

      {scanError ? (
        <Alert variant="destructive">
          <AlertTitle>{t(locale, 'admin.assets.page.operationFailed')}</AlertTitle>
          <AlertDescription>{scanError}</AlertDescription>
        </Alert>
      ) : null}

      {job ? (
        <AssetsCleanupCard job={job} retrying={retryMutation.isPending} onRetry={() => void retryCleanup()} />
      ) : null}

      {!hasReport && !isScanning ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HardDrive />
            </EmptyMedia>
            <EmptyTitle>{t(locale, 'admin.assets.page.emptyTitle')}</EmptyTitle>
          </EmptyHeader>
          <Button onClick={() => void runScan()}>{t(locale, 'admin.assets.page.scanNow')}</Button>
        </Empty>
      ) : null}

      {isScanning && !hasReport ? <AssetsSummary report={null} loading /> : null}

      {report ? (
        <>
          {!report.scanComplete ? (
            <Alert>
              <AlertTitle>{t(locale, 'admin.assets.page.scanIncompleteTitle')}</AlertTitle>
              <AlertDescription>{t(locale, 'admin.assets.page.scanIncompleteDescription')}</AlertDescription>
            </Alert>
          ) : null}

          <AssetsSummary report={report} loading={isScanning} />

          <div className="grid gap-4 lg:grid-cols-2">
            <AssetsChart categories={report.categories} />
            <Card>
              <CardHeader>
                <CardTitle>{t(locale, 'admin.assets.page.orphanOverviewTitle')}</CardTitle>
                <CardDescription>
                  {t(locale, 'admin.assets.page.orphanShare', {
                    percent:
                      report.totalBytes > 0 ? `${((report.orphanBytes / report.totalBytes) * 100).toFixed(1)}%` : '0%',
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-2xl font-semibold tracking-tight text-destructive">
                  {t(locale, 'admin.assets.page.releasable', { bytes: formatStorageBytes(report.orphanBytes) })}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t(locale, 'admin.assets.page.orphanFound', { count: report.orphanCount })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setObjectQuery({ ...INITIAL_OBJECT_QUERY, status: 'orphan' })}
                  >
                    {t(locale, 'admin.assets.page.viewOrphans')}
                  </Button>
                  <Button variant="destructive" disabled={!canOpenCleanup} onClick={() => setIsCleanupOpen(true)}>
                    {t(locale, 'admin.assets.page.cleanupOrphans')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <AssetsLargestList objects={report.largestObjects} />
          <AssetsObjectTable scanId={report.scanId} query={objectQuery} onQueryChange={setObjectQuery} />

          <AssetsCleanupDialog
            open={isCleanupOpen}
            onOpenChange={setIsCleanupOpen}
            report={report}
            pending={enqueueMutation.isPending}
            onConfirm={() => void enqueueCleanup()}
          />
        </>
      ) : null}
    </div>
  );
}
