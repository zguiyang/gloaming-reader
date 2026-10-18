import { Hourglass } from 'lucide-react';
import type { ReactNode } from 'react';

import { t } from '@gloaming/i18n';
import type {
  DiscoverySyncRunHistory,
  DiscoverySyncRunProgress,
  DiscoverySyncRunSummary,
} from '@gloaming/shared/discovery';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  discoverySyncRunStageLabel,
  formatDiscoveryElapsed,
  formatDiscoveryTimestamp,
} from '@/features/admin/discovery-sources/discovery-sources-format';
import { useLocale } from '@/lib/locale-context';

type DiscoverySyncRunPanelProps = {
  progress: DiscoverySyncRunProgress;
  history: DiscoverySyncRunHistory | undefined;
  historyPending: boolean;
  /** True when the run-history fetch failed; rendered as an error with retry, never as an empty history. */
  historyError?: boolean;
  onRetryHistory?: () => void;
};

function stageBadgeVariant(stage: DiscoverySyncRunSummary['stage']): 'secondary' | 'destructive' | 'outline' {
  if (stage === 'succeeded' || stage === 'not_modified') return 'secondary';
  if (stage === 'failed') return 'destructive';
  return 'outline';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Current-run progress plus bounded recent-run history. All metrics are
 * current-run committed facts: no totals, no percentages, no invented
 * inserted/updated splits. A queued run distinguishes real consumer evidence
 * (`available`), a conservatively unavailable consumer, and `unknown` when the
 * queue cannot be consulted — the last two are never rendered as a failed queue.
 */
export function DiscoverySyncRunPanel({
  progress,
  history,
  historyPending,
  historyError,
  onRetryHistory,
}: DiscoverySyncRunPanelProps) {
  const { locale } = useLocale();
  const run = progress.run;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(locale, 'admin.discoverySources.run.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {run ? (
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label={t(locale, 'admin.discoverySources.run.fields.stage')}>
              <div className="flex items-center gap-2">
                <Badge variant={stageBadgeVariant(run.stage)}>{discoverySyncRunStageLabel(run.stage, locale)}</Badge>
                {run.stage === 'queued' ? (
                  <span className="text-xs text-muted-foreground" data-testid="queued-consumer-hint">
                    {progress.consumer === 'available'
                      ? t(locale, 'admin.discoverySources.run.consumer.available')
                      : progress.consumer === 'unavailable'
                        ? t(locale, 'admin.discoverySources.run.consumer.unavailable')
                        : t(locale, 'admin.discoverySources.run.consumer.unknown')}
                  </span>
                ) : null}
              </div>
            </Field>
            <Field label={t(locale, 'admin.discoverySources.run.fields.elapsed')}>
              {formatDiscoveryElapsed(run.startedAt ?? run.queuedAt, locale, { finishedAt: run.finishedAt })}
            </Field>
            <Field label={t(locale, 'admin.discoverySources.run.fields.committedRecords')}>
              {t(locale, 'admin.discoverySources.run.committedRecords', { count: run.committedRecords })}
            </Field>
            <Field label={t(locale, 'admin.discoverySources.run.fields.committedBatches')}>
              {t(locale, 'admin.discoverySources.run.committedBatches', { count: run.committedBatches })}
            </Field>
            <Field label={t(locale, 'admin.discoverySources.run.fields.lastActivity')}>
              {formatDiscoveryTimestamp(run.lastActivityAt, locale)}
            </Field>
            <Field label={t(locale, 'admin.discoverySources.run.fields.finished')}>
              {formatDiscoveryTimestamp(run.finishedAt, locale)}
            </Field>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t(locale, 'admin.discoverySources.run.empty')}</p>
        )}

        {run?.stage === 'failed' && run.errorSummary ? (
          <p className="text-sm text-destructive" data-testid="run-error-summary">
            {run.errorSummary}
          </p>
        ) : null}

        <section aria-labelledby="discovery-sync-recent-runs">
          <h3 id="discovery-sync-recent-runs" className="mb-2 text-sm font-medium">
            {t(locale, 'admin.discoverySources.run.recent.title')}
          </h3>
          {historyPending && !history ? (
            <Skeleton className="h-24 rounded-xl" data-testid="history-skeleton" />
          ) : historyError ? (
            <div className="flex items-center gap-2 text-sm" data-testid="history-error">
              <span className="text-destructive">{t(locale, 'admin.discoverySources.run.recent.error')}</span>
              {onRetryHistory ? (
                <button
                  type="button"
                  onClick={onRetryHistory}
                  data-testid="history-retry"
                  className="rounded-md border px-2 py-0.5 text-foreground hover:bg-muted"
                >
                  {t(locale, 'admin.discoverySources.run.recent.retry')}
                </button>
              ) : null}
            </div>
          ) : history && history.runs.length > 0 ? (
            <ul className="flex flex-col gap-2" data-testid="recent-runs">
              {history.runs.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm"
                >
                  <Badge variant={stageBadgeVariant(entry.stage)}>
                    {discoverySyncRunStageLabel(entry.stage, locale)}
                  </Badge>
                  <span className="text-muted-foreground">{formatDiscoveryTimestamp(entry.queuedAt, locale)}</span>
                  <span className="text-muted-foreground">
                    {t(locale, 'admin.discoverySources.run.committedRecords', { count: entry.committedRecords })}
                  </span>
                  {entry.stage === 'succeeded' ? (
                    <span className="text-muted-foreground">
                      {t(locale, 'admin.discoverySources.run.unavailableRecords', {
                        count: entry.unavailableRecords,
                      })}
                    </span>
                  ) : null}
                  {entry.errorSummary ? (
                    <span className="text-destructive" data-testid={`run-error-${entry.id}`}>
                      {entry.errorSummary}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Hourglass data-icon="inline-start" aria-hidden="true" />
              {t(locale, 'admin.discoverySources.run.recent.empty')}
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
