'use client';

import type { AssetScanReport } from '@gloaming/shared/assets';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatStorageBytes } from '@/features/admin/assets/assets-format';
import { cn } from '@/lib/utils';

type AssetsSummaryProps = {
  report: AssetScanReport | null;
  loading?: boolean;
};

function SummaryCard({
  title,
  primary,
  secondary,
  tone = 'default',
}: {
  title: string;
  primary: string;
  secondary: string;
  tone?: 'default' | 'destructive' | 'success';
}) {
  return (
    <Card size="sm" className={cn(tone === 'destructive' && 'ring-destructive/30')}>
      <CardHeader className="pb-0">
        <CardDescription>{title}</CardDescription>
        <CardTitle
          className={cn(
            'text-2xl font-semibold tracking-tight',
            tone === 'destructive' && 'text-destructive',
            tone === 'success' && 'text-foreground',
          )}
        >
          {primary}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{secondary}</p>
      </CardContent>
    </Card>
  );
}

export function AssetsSummary({ report, loading }: AssetsSummaryProps) {
  if (loading || !report) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} size="sm">
            <CardHeader>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-28" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const orphanShare = report.totalBytes > 0 ? ((report.orphanBytes / report.totalBytes) * 100).toFixed(1) : '0.0';

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        title="总占用"
        primary={formatStorageBytes(report.totalBytes)}
        secondary={`${report.objectCount} 个对象`}
      />
      <SummaryCard
        title="正常引用"
        primary={formatStorageBytes(report.referencedBytes)}
        secondary={`${report.referencedObjectCount} 个对象`}
        tone="success"
      />
      <SummaryCard
        title="孤儿对象"
        primary={formatStorageBytes(report.orphanBytes)}
        secondary={`${report.orphanCount} 个对象 · 占总容量 ${orphanShare}%`}
        tone="destructive"
      />
      <SummaryCard title="缺失对象" primary={`${report.missingCount} 个`} secondary="数据库有引用，对象存储缺失" />
    </div>
  );
}
