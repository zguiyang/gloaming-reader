'use client';

import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import type { DiscoverySourceSyncStatus } from '@gloaming/shared/discovery';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import {
  formatDiscoverySourcesApiError,
  isDiscoverySyncPending,
  useDiscoverySourceStatusQuery,
  useSetDiscoverySourceEnabledMutation,
  useTriggerDiscoverySourceSyncMutation,
} from '@/features/admin/discovery-sources/discovery-sources-api';
import {
  discoverySyncStatusLabel,
  formatDiscoveryTimestamp,
} from '@/features/admin/discovery-sources/discovery-sources-format';
import { useLocale } from '@/lib/locale-context';

type StatusFieldProps = {
  label: string;
  children: ReactNode;
};

function StatusField({ label, children }: StatusFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

function statusBadgeVariant(status: DiscoverySourceSyncStatus): 'secondary' | 'destructive' | 'outline' {
  if (status === 'succeeded') return 'secondary';
  if (status === 'failed') return 'destructive';
  return 'outline';
}

function PageHeading() {
  const { locale } = useLocale();
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{t(locale, 'admin.discoverySources.page.title')}</h1>
      <p className="text-sm text-muted-foreground">{t(locale, 'admin.discoverySources.page.subtitle')}</p>
    </header>
  );
}

export function DiscoverySourcesPage() {
  const { locale } = useLocale();
  const statusQuery = useDiscoverySourceStatusQuery();
  const enabledMutation = useSetDiscoverySourceEnabledMutation();
  const syncMutation = useTriggerDiscoverySourceSyncMutation();
  const status = statusQuery.data;
  const operationFailed = t(locale, 'admin.discoverySources.page.operationFailed');

  async function toggleEnabled(enabled: boolean) {
    try {
      await enabledMutation.mutateAsync(enabled);
    } catch (error) {
      toast.error(formatDiscoverySourcesApiError(error) || operationFailed);
    }
  }

  async function runSync() {
    try {
      const accepted = await syncMutation.mutateAsync();
      if (accepted.result === 'queued') {
        toast.success(t(locale, 'admin.discoverySources.toast.queued'));
        return;
      }
      toast.warning(
        accepted.result === 'disabled'
          ? t(locale, 'admin.discoverySources.toast.disabled')
          : t(locale, 'admin.discoverySources.toast.alreadyRunning'),
      );
    } catch (error) {
      toast.error(formatDiscoverySourcesApiError(error) || operationFailed);
    }
  }

  if (statusQuery.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading />
        <Alert variant="destructive">
          <AlertTitle>{operationFailed}</AlertTitle>
          <AlertDescription>
            {formatDiscoverySourcesApiError(statusQuery.error) || t(locale, 'admin.discoverySources.page.loadFailed')}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const isSyncPending = isDiscoverySyncPending(status.syncStatus);
  const isSourceDisabled = !status.enabled;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>Project Gutenberg</CardTitle>
              <p className="font-mono text-xs text-muted-foreground">{status.sourceType}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {status.enabled
                  ? t(locale, 'admin.discoverySources.enabled.label')
                  : t(locale, 'admin.discoverySources.disabled.label')}
              </span>
              <Switch
                checked={status.enabled}
                disabled={enabledMutation.isPending}
                onCheckedChange={(checked) => void toggleEnabled(checked)}
                aria-label={t(
                  locale,
                  status.enabled
                    ? 'admin.discoverySources.toggleDisableAria'
                    : 'admin.discoverySources.toggleEnableAria',
                )}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatusField label={t(locale, 'admin.discoverySources.fields.status')}>
              <Badge variant={statusBadgeVariant(status.syncStatus)}>
                {discoverySyncStatusLabel(status.syncStatus, locale)}
              </Badge>
            </StatusField>
            <StatusField label={t(locale, 'admin.discoverySources.fields.lastSync')}>
              {formatDiscoveryTimestamp(status.syncFinishedAt, locale)}
            </StatusField>
            <StatusField label={t(locale, 'admin.discoverySources.fields.lastSuccess')}>
              {formatDiscoveryTimestamp(status.lastSuccessAt, locale)}
            </StatusField>
            <StatusField label={t(locale, 'admin.discoverySources.fields.recordCount')}>
              {t(locale, 'admin.discoverySources.recordCount', { count: status.recordCount })}
            </StatusField>
          </dl>

          {status.lastErrorSummary ? (
            <Alert variant="destructive">
              <AlertTitle>{t(locale, 'admin.discoverySources.fields.errorSummary')}</AlertTitle>
              <AlertDescription>{status.lastErrorSummary}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void runSync()}
              disabled={isSyncPending || isSourceDisabled || syncMutation.isPending}
            >
              {syncMutation.isPending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
              {isSyncPending
                ? t(locale, 'admin.discoverySources.syncing')
                : t(locale, 'admin.discoverySources.syncNow')}
            </Button>
            {isSourceDisabled ? (
              <p className="text-sm text-muted-foreground">{t(locale, 'admin.discoverySources.disabledSyncHint')}</p>
            ) : isSyncPending ? (
              <p className="text-sm text-muted-foreground">{t(locale, 'admin.discoverySources.pendingHint')}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
