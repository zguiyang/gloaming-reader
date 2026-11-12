'use client';

import { t } from '@gloaming/i18n';
import type { AssetCleanupJob } from '@gloaming/shared/assets';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cleanupProgressPercent } from '@/features/admin/assets/assets-cleanup-card';
import { assetCleanupJobStatusLabel, formatStorageBytes } from '@/features/admin/assets/assets-format';
import { useLocale } from '@/lib/locale-context';

type AssetsCleanupBannerProps = {
  job: AssetCleanupJob;
  onOpenDetails: () => void;
};

export function AssetsCleanupBanner({ job, onOpenDetails }: AssetsCleanupBannerProps) {
  const { locale } = useLocale();
  const percent = cleanupProgressPercent(job);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{t(locale, 'admin.assets.cleanupBanner.title')}</p>
          <Badge variant="outline">{assetCleanupJobStatusLabel(job.status, locale)}</Badge>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onOpenDetails}>
          {t(locale, 'admin.assets.page.cleanupDetails')}
        </Button>
      </div>
      <Progress
        className="h-1.5 rounded-full bg-muted"
        value={percent}
        aria-label={t(locale, 'admin.assets.cleanup.progressAria')}
      />
      <p className="text-muted-foreground text-xs">
        {t(locale, 'admin.assets.cleanupBanner.progress', {
          processed: job.processedCount,
          requested: job.requestedCount,
          bytes: formatStorageBytes(job.deletedBytes),
        })}
      </p>
    </div>
  );
}
