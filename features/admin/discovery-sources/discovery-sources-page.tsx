'use client';

import { ChevronDown, History, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { t } from '@/i18n';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  formatDiscoverySourcesApiError,
  useDiscoverySourceRunsQuery,
  useDiscoverySourcesQuery,
  useTriggerDiscoverySourceSyncMutation,
  useUpdateDiscoverySourceSettingsMutation,
} from '@/features/admin/discovery-sources/discovery-sources-api';
import {
  discoverySyncStatusLabel,
  formatDiscoveryTimestamp,
} from '@/features/admin/discovery-sources/discovery-sources-format';
import { DiscoverySyncRunsDialog } from '@/features/admin/discovery-sources/discovery-sync-runs-dialog';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';
import type { DiscoverySourceStatus } from '@/shared/discovery';

type SourceDraft = {
  enabled: boolean;
  maxRows: number;
};

function sourceDisplayName(sourceKey: string, locale: Parameters<typeof t>[0]): string {
  const key = `admin.discoverySources.names.${sourceKey}` as const;
  const label = t(locale, key);
  return label === key ? sourceKey : label;
}

function statusBadgeVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  if (status === 'succeeded') return 'secondary';
  if (status === 'failed') return 'destructive';
  return 'outline';
}

function StatusMetric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

function toDraft(source: DiscoverySourceStatus): SourceDraft {
  return { enabled: source.enabled, maxRows: source.maxRows };
}

function draftsEqual(a: SourceDraft, b: SourceDraft): boolean {
  return a.enabled === b.enabled && a.maxRows === b.maxRows;
}

function SourceCard({ source }: { source: DiscoverySourceStatus }) {
  const { locale } = useLocale();
  const name = sourceDisplayName(source.sourceKey, locale);
  const baseline = toDraft(source);
  const [open, setOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [draft, setDraft] = useState<SourceDraft>(baseline);
  const [syncedBaseline, setSyncedBaseline] = useState<SourceDraft>(baseline);
  // Reset the editable draft when server settings change (e.g. after save/refetch).
  if (!draftsEqual(baseline, syncedBaseline)) {
    setSyncedBaseline(baseline);
    setDraft(baseline);
  }
  const dirty = !draftsEqual(draft, baseline);

  const saveMutation = useUpdateDiscoverySourceSettingsMutation();
  const syncMutation = useTriggerDiscoverySourceSyncMutation();
  const runsQuery = useDiscoverySourceRunsQuery(source.sourceKey, runsOpen);

  function patchDraft(patch: Partial<SourceDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  async function handleSave() {
    try {
      await saveMutation.mutateAsync({
        sourceKey: source.sourceKey,
        patch: { enabled: draft.enabled, maxRows: draft.maxRows },
      });
      toast.message(t(locale, 'admin.discoverySources.toast.saved'));
    } catch (error) {
      toast.error(formatDiscoverySourcesApiError(error));
    }
  }

  async function handleSyncNow() {
    try {
      const accepted = await syncMutation.mutateAsync({ sourceKey: source.sourceKey });
      if (accepted.result === 'queued') {
        toast.message(t(locale, 'admin.discoverySources.toast.syncQueued'));
        return;
      }
      if (accepted.result === 'already_running') {
        toast.message(t(locale, 'admin.discoverySources.toast.syncAlreadyRunning'));
        return;
      }
      toast.message(t(locale, 'admin.discoverySources.toast.syncDisabled'));
    } catch (error) {
      toast.error(formatDiscoverySourcesApiError(error));
    }
  }

  return (
    <>
      <section className="rounded-xl border border-border/70">
        <div className="flex items-start gap-3 px-5 pt-4">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-2 text-left"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
          >
            <ChevronDown
              className={cn('mt-1 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
              aria-hidden
            />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-foreground">{name}</h2>
                <Badge variant={statusBadgeVariant(source.syncStatus)}>
                  {discoverySyncStatusLabel(source.syncStatus, locale)}
                </Badge>
              </div>
              <p className="font-mono text-xs text-muted-foreground">{source.sourceKey}</p>
            </div>
          </button>

          <div
            className="flex shrink-0 items-center pt-0.5"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Switch
              checked={draft.enabled}
              onCheckedChange={(enabled) => patchDraft({ enabled })}
              aria-label={
                draft.enabled
                  ? t(locale, 'admin.discoverySources.toggleDisableAria', { name })
                  : t(locale, 'admin.discoverySources.toggleEnableAria', { name })
              }
            />
          </div>
        </div>

        <button
          type="button"
          className="w-full px-5 pt-4 pb-4 text-left"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          <dl className="grid gap-3 sm:grid-cols-3">
            <StatusMetric label={t(locale, 'admin.discoverySources.fields.recordCount')}>
              {t(locale, 'admin.discoverySources.recordCount', { count: source.recordCount })}
            </StatusMetric>
            <StatusMetric label={t(locale, 'admin.discoverySources.fields.indexSize')}>
              {t(locale, 'admin.discoverySources.indexSize', {
                used: source.estimatedIndexMiB,
                budget: source.budgetMiB,
              })}
            </StatusMetric>
            <StatusMetric label={t(locale, 'admin.discoverySources.fields.lastSuccess')}>
              {formatDiscoveryTimestamp(source.lastSuccessAt, locale)}
            </StatusMetric>
          </dl>
        </button>

        {open ? (
          <div className="flex flex-col gap-5 border-t border-border/60 px-5 py-4">
            {source.lastErrorSummary ? (
              <Alert variant="destructive">
                <AlertTitle>{t(locale, 'admin.discoverySources.fields.errorSummary')}</AlertTitle>
                <AlertDescription>{source.lastErrorSummary}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup className="gap-4">
              <Field orientation="horizontal" className="items-center justify-between">
                <FieldLabel htmlFor={`${source.sourceKey}-max-rows`}>
                  {t(locale, 'admin.discoverySources.fields.maxRows')}
                </FieldLabel>
                <Input
                  id={`${source.sourceKey}-max-rows`}
                  type="number"
                  min={100}
                  max={100_000}
                  step={100}
                  appearance="filled"
                  className="h-10 w-[8.5rem]"
                  disabled={!draft.enabled}
                  value={draft.maxRows}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    if (Number.isFinite(next)) patchDraft({ maxRows: next });
                  }}
                />
              </Field>
            </FieldGroup>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={!dirty || saveMutation.isPending} onClick={() => void handleSave()}>
                {t(locale, 'admin.discoverySources.actions.save')}
              </Button>
              <Button type="button" variant="outline" disabled={!dirty} onClick={() => setDraft(baseline)}>
                {t(locale, 'admin.discoverySources.actions.reset')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!draft.enabled || syncMutation.isPending}
                onClick={() => void handleSyncNow()}
              >
                <RefreshCw data-icon="inline-start" />
                {t(locale, 'admin.discoverySources.actions.syncNow')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRunsOpen(true)}>
                <History data-icon="inline-start" />
                {t(locale, 'admin.discoverySources.actions.viewRuns')}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <DiscoverySyncRunsDialog
        open={runsOpen}
        onOpenChange={setRunsOpen}
        sourceName={name}
        runs={runsQuery.data?.runs ?? []}
      />
    </>
  );
}

/** Admin UI for bounded Discover catalog sources. */
export function DiscoverySourcesPage() {
  const { locale } = useLocale();
  const sourcesQuery = useDiscoverySourcesQuery();

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-6">
      <header>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
          {t(locale, 'admin.discoverySources.page.title')}
        </h1>
      </header>

      {sourcesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t(locale, 'admin.discoverySources.page.loadFailed')}</AlertTitle>
          <AlertDescription>{formatDiscoverySourcesApiError(sourcesQuery.error)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        {(sourcesQuery.data?.items ?? []).map((source) => (
          <SourceCard key={source.sourceKey} source={source} />
        ))}
      </div>
    </div>
  );
}
