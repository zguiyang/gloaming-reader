'use client';

import type { AssetCleanupJob } from '@gloaming/shared/assets';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { canRetryCleanupJob } from '@/features/admin/assets/assets-cleanup-state';
import { assetCleanupJobStatusLabel, formatStorageBytes, shortObjectKey } from '@/features/admin/assets/assets-format';
import { cn } from '@/lib/utils';

type AssetsCleanupCardProps = {
  job: AssetCleanupJob;
  retrying?: boolean;
  onRetry?: () => void;
};

export function cleanupProgressPercent(job: Pick<AssetCleanupJob, 'processedCount' | 'requestedCount'>): number {
  if (job.requestedCount <= 0) return 100;
  return Math.min(100, Math.round((job.processedCount / job.requestedCount) * 100));
}

function leftoverFailureCount(job: Pick<AssetCleanupJob, 'failedCount' | 'failedSample'>): number {
  return Math.max(0, job.failedCount - job.failedSample.length);
}

function hasLeftoverUncleanedObjects(job: AssetCleanupJob): boolean {
  const verification = job.verification;
  if (!verification) return false;
  return (verification.orphanCount ?? 0) > 0 || verification.scanComplete === false;
}

export function AssetsCleanupCard({ job, retrying = false, onRetry }: AssetsCleanupCardProps) {
  const percent = cleanupProgressPercent(job);
  const leftoverFailures = leftoverFailureCount(job);
  const canRetry = canRetryCleanupJob(job) && Boolean(onRetry);
  const isInFlight = job.status === 'queued' || job.status === 'running';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>孤儿对象清理</CardTitle>
          <Badge
            variant={
              job.status === 'partial' || job.status === 'failed'
                ? 'destructive'
                : job.status === 'completed'
                  ? 'secondary'
                  : 'outline'
            }
          >
            {assetCleanupJobStatusLabel(job.status)}
          </Badge>
        </div>
        <CardDescription>
          {job.processedCount} / {job.requestedCount} · 已释放 {formatStorageBytes(job.deletedBytes)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          className="bg-muted h-2 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="清理进度"
        >
          <div
            className={cn('bg-primary h-full transition-[width]', job.status === 'failed' && 'bg-destructive')}
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="text-muted-foreground text-sm">
          删除 {job.deletedCount} · 跳过 {job.skippedReferencedCount} · 失败 {job.failedCount}
        </p>
        {job.error ? <p className="text-destructive text-sm">{job.error}</p> : null}
        {job.status === 'partial' && hasLeftoverUncleanedObjects(job) ? (
          <p className="text-destructive text-sm">任务执行结束，但仍有未清理对象</p>
        ) : null}
        {job.verification?.ran ? (
          <p className="text-muted-foreground text-sm">
            清理后仍有孤儿 {job.verification.orphanCount ?? 0} · 缺失 {job.verification.missingCount ?? 0}
          </p>
        ) : null}
        {job.failedSample.length > 0 ? (
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
            {job.failedSample.map((entry) => (
              <li key={entry.key} className="text-destructive truncate" title={`${entry.key}: ${entry.error}`}>
                {shortObjectKey(entry.key)} · {entry.error}
              </li>
            ))}
          </ul>
        ) : null}
        {leftoverFailures > 0 ? (
          <p className="text-muted-foreground text-sm">还有 {leftoverFailures} 个失败对象未展开</p>
        ) : null}
        {canRetry ? (
          <Button variant="outline" disabled={retrying} onClick={onRetry}>
            {retrying ? <Spinner data-icon="inline-start" /> : null}
            {retrying ? '重试提交中…' : '重试失败对象'}
          </Button>
        ) : null}
        {isInFlight ? <p className="text-muted-foreground text-sm">任务在后台执行，可继续浏览本页。</p> : null}
      </CardContent>
    </Card>
  );
}
