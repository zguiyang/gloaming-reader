'use client';

import { XIcon } from 'lucide-react';

import { t } from '@/i18n';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  discoverySyncRunStageLabel,
  formatDiscoveryElapsed,
  formatDiscoveryTimestamp,
} from '@/features/admin/discovery-sources/discovery-sources-format';
import { useLocale } from '@/lib/locale-context';
import type { DiscoverySyncRunSummary } from '@/shared/discovery';

type DiscoverySyncRunsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceName: string;
  runs: DiscoverySyncRunSummary[];
};

function stageBadgeVariant(stage: string): 'secondary' | 'destructive' | 'outline' {
  if (stage === 'succeeded' || stage === 'not_modified') return 'secondary';
  if (stage === 'failed') return 'destructive';
  return 'outline';
}

/** Bounded dialog: fixed max height; list scrolls inside so the page is never stretched. */
export function DiscoverySyncRunsDialog({ open, onOpenChange, sourceName, runs }: DiscoverySyncRunsDialogProps) {
  const { locale } = useLocale();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(32rem,calc(100dvh-2rem))] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/50 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle className="text-lg font-semibold tracking-tight">
              {t(locale, 'admin.discoverySources.run.title')}
            </DialogTitle>
            <DialogDescription className="truncate text-sm text-muted-foreground">{sourceName}</DialogDescription>
          </div>
          <DialogClose
            render={<Button type="button" variant="ghost" size="icon-sm" className="-mr-2 -mt-1 shrink-0" />}
            aria-label={t(locale, 'common.close')}
          >
            <XIcon aria-hidden />
          </DialogClose>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(locale, 'admin.discoverySources.run.recent.empty')}</p>
          ) : (
            <ul className="flex flex-col">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-col gap-2 border-b border-border/60 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={stageBadgeVariant(run.stage)}>
                        {discoverySyncRunStageLabel(run.stage, locale)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDiscoveryTimestamp(run.queuedAt, locale)}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDiscoveryElapsed(run.queuedAt, run.finishedAt, locale)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t(locale, 'admin.discoverySources.run.counters', {
                      inserted: run.inserted,
                      refreshed: run.refreshed,
                      evicted: run.evicted,
                      skipped: run.skippedFilter,
                    })}
                  </p>
                  {run.errorSummary ? <p className="text-sm text-destructive">{run.errorSummary}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
