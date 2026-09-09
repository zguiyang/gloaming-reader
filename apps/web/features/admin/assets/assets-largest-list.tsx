'use client';

import type { AssetObjectItem } from '@gloaming/shared/assets';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  assetCategoryLabel,
  formatMeasuredAt,
  formatStorageBytes,
  shortObjectKey,
} from '@/features/admin/assets/assets-format';

type AssetsLargestListProps = {
  objects: AssetObjectItem[];
};

export function AssetsLargestList({ objects }: AssetsLargestListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>最大对象排行</CardTitle>
        <CardDescription>按文件大小倒序，便于发现异常大对象</CardDescription>
      </CardHeader>
      <CardContent>
        {objects.length === 0 ? (
          <p className="text-muted-foreground text-sm">暂无对象</p>
        ) : (
          <ol className="space-y-3">
            {objects.map((object, index) => (
              <li key={object.key} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium" title={object.key}>
                    <span className="text-muted-foreground mr-2 tabular-nums">{index + 1}.</span>
                    {shortObjectKey(object.key)}
                  </p>
                  <div className="text-muted-foreground flex flex-wrap items-center gap-2">
                    <span>{assetCategoryLabel(object.category)}</span>
                    {object.lastModified ? <span>{formatMeasuredAt(object.lastModified)}</span> : null}
                    {object.status === 'orphan' ? <Badge variant="destructive">孤儿</Badge> : null}
                  </div>
                </div>
                <span className="shrink-0 font-medium tabular-nums">{formatStorageBytes(object.size)}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
