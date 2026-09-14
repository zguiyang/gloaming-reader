'use client';

import { t } from '@gloaming/i18n';
import type { AssetObjectItem } from '@gloaming/shared/assets';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  assetCategoryLabel,
  assetStatusLabel,
  formatMeasuredAt,
  formatStorageBytes,
  shortObjectKey,
} from '@/features/admin/assets/assets-format';
import { useLocale } from '@/lib/locale-context';

type AssetsLargestListProps = {
  objects: AssetObjectItem[];
};

export function AssetsLargestList({ objects }: AssetsLargestListProps) {
  const { locale } = useLocale();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(locale, 'admin.assets.largest.title')}</CardTitle>
        <CardDescription>{t(locale, 'admin.assets.largest.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {objects.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t(locale, 'admin.assets.largest.empty')}</p>
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
                    <span>{assetCategoryLabel(object.category, locale)}</span>
                    {object.lastModified ? <span>{formatMeasuredAt(object.lastModified, locale)}</span> : null}
                    {object.status === 'orphan' ? (
                      <Badge variant="destructive">{assetStatusLabel('orphan', locale)}</Badge>
                    ) : null}
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
