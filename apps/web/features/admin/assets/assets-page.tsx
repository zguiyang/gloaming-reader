'use client';

import { HardDrive, RefreshCw } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';

import type { AssetCleanupResult, AssetObjectListQuery, AssetScanReport } from '@gloaming/shared/assets';
import { ASSET_OBJECT_DEFAULT_PAGE_SIZE, DEFAULT_ASSET_OBJECT_SORT_BY } from '@gloaming/shared/assets';
import { DEFAULT_PAGE, DEFAULT_SORT_ORDER } from '@gloaming/shared/pagination';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatAssetsApiError,
  useCleanupOrphanAssetsMutation,
  useScanAssetsMutation,
} from '@/features/admin/assets/assets-api';
import { AssetsCleanupDialog } from '@/features/admin/assets/assets-cleanup-dialog';
import { formatMeasuredAt, formatStorageBytes } from '@/features/admin/assets/assets-format';
import { AssetsLargestList } from '@/features/admin/assets/assets-largest-list';
import { AssetsObjectTable } from '@/features/admin/assets/assets-object-table';
import { AssetsSummary } from '@/features/admin/assets/assets-summary';

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
  const scanMutation = useScanAssetsMutation();
  const cleanupMutation = useCleanupOrphanAssetsMutation();
  const [report, setReport] = useState<AssetScanReport | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [isCleanupOpen, setIsCleanupOpen] = useState(false);
  const [objectQuery, setObjectQuery] = useState<AssetObjectListQuery>(INITIAL_OBJECT_QUERY);

  const isScanning = scanMutation.isPending;
  const hasReport = report !== null;

  async function runScan() {
    setScanError(null);
    setCleanupMessage(null);
    try {
      const next = await scanMutation.mutateAsync();
      setReport(next);
      setObjectQuery(INITIAL_OBJECT_QUERY);
    } catch (error) {
      setScanError(formatAssetsApiError(error) || '无法读取对象存储，请检查 S3 配置或网络连接。');
    }
  }

  async function runCleanup() {
    if (!report) return;
    try {
      const result = await cleanupMutation.mutateAsync(report.scanId);
      setIsCleanupOpen(false);
      setCleanupMessage(formatCleanupMessage(result));
      await runScan();
    } catch (error) {
      setIsCleanupOpen(false);
      setScanError(formatAssetsApiError(error) || '清理失败，请重新扫描后再试。');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">资产管理</h1>
          <p className="text-muted-foreground text-sm">对象存储扫描占用（非供应商账单）。用于发现大对象与孤儿对象。</p>
          {report ? (
            <p className="text-muted-foreground text-sm">
              最近扫描：{formatMeasuredAt(report.measuredAt)} · 扫描状态：
              {report.scanComplete ? '已完成' : '未完成'}
            </p>
          ) : null}
        </div>
        <Button onClick={() => void runScan()} disabled={isScanning || cleanupMutation.isPending}>
          <RefreshCw className={isScanning ? 'animate-spin' : undefined} />
          {isScanning ? '扫描中…' : '立即扫描'}
        </Button>
      </div>

      {scanError ? (
        <Alert variant="destructive">
          <AlertTitle>扫描失败</AlertTitle>
          <AlertDescription>{scanError}</AlertDescription>
        </Alert>
      ) : null}

      {cleanupMessage ? (
        <Alert>
          <AlertTitle>清理结果</AlertTitle>
          <AlertDescription>{cleanupMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!hasReport && !isScanning ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HardDrive />
            </EmptyMedia>
            <EmptyTitle>尚未进行资产扫描</EmptyTitle>
            <EmptyDescription>扫描对象存储后，可以查看容量构成和孤儿对象。</EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => void runScan()}>立即扫描</Button>
        </Empty>
      ) : null}

      {isScanning && !hasReport ? <AssetsSummary report={null} loading /> : null}

      {report ? (
        <>
          <AssetsSummary report={report} loading={isScanning} />

          <div className="grid gap-4 lg:grid-cols-2">
            <AssetsChart categories={report.categories} />
            <Card>
              <CardHeader>
                <CardTitle>孤儿对象概览</CardTitle>
                <CardDescription>
                  孤儿占比{' '}
                  {report.totalBytes > 0 ? `${((report.orphanBytes / report.totalBytes) * 100).toFixed(1)}%` : '0%'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-2xl font-semibold tracking-tight text-destructive">
                  可释放 {formatStorageBytes(report.orphanBytes)}
                </p>
                <p className="text-muted-foreground text-sm">发现 {report.orphanCount} 个孤儿对象</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setObjectQuery({ ...INITIAL_OBJECT_QUERY, status: 'orphan' })}
                  >
                    查看孤儿对象
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={report.orphanCount === 0 || isScanning || cleanupMutation.isPending}
                    onClick={() => setIsCleanupOpen(true)}
                  >
                    清理孤儿对象
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
            pending={cleanupMutation.isPending}
            onConfirm={() => void runCleanup()}
          />
        </>
      ) : null}
    </div>
  );
}

function formatCleanupMessage(result: AssetCleanupResult): string {
  if (result.failedCount === 0 && result.skippedReferencedCount === 0) {
    return `已清理 ${result.deletedCount} 个对象，释放约 ${formatStorageBytes(result.deletedBytes)}。`;
  }
  return [
    `已删除 ${result.deletedCount} 个对象`,
    `${result.skippedReferencedCount} 个对象因重新被引用而跳过`,
    `${result.failedCount} 个对象删除失败`,
  ].join(' · ');
}
