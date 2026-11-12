'use client';

import { toast } from 'sonner';

import { t } from '@/i18n';
import type { DiscoverySourceSummary } from '@/shared/discovery';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  formatDiscoverySourcesApiError,
  useDiscoverySourcesQuery,
  useSetDiscoverySourceEnabledMutation,
} from '@/features/admin/discovery-sources/discovery-sources-api';
import { useLocale } from '@/lib/locale-context';

function sourceDisplayName(sourceKey: string, locale: Parameters<typeof t>[0]): string {
  const key = `admin.discoverySources.names.${sourceKey}` as const;
  const label = t(locale, key);
  return label === key ? sourceKey : label;
}

function SourceRow({ source }: { source: DiscoverySourceSummary }) {
  const { locale } = useLocale();
  const enabledMutation = useSetDiscoverySourceEnabledMutation();
  const name = sourceDisplayName(source.sourceKey, locale);

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-4 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="truncate text-base font-semibold text-foreground">{name}</h2>
        <p className="text-sm text-muted-foreground">
          {t(locale, 'admin.discoverySources.fields.sourceKey')}: {source.sourceKey}
        </p>
        <p className="text-sm text-muted-foreground">
          {t(locale, 'admin.discoverySources.fields.sourceType')}: {source.sourceType}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {t(locale, source.enabled ? 'admin.discoverySources.enabled.label' : 'admin.discoverySources.disabled.label')}
        </span>
        <Switch
          checked={source.enabled}
          disabled={enabledMutation.isPending}
          onCheckedChange={(enabled) => {
            enabledMutation.mutate(
              { sourceKey: source.sourceKey, enabled },
              {
                onError: (error) => {
                  toast.error(
                    formatDiscoverySourcesApiError(error) || t(locale, 'admin.discoverySources.page.operationFailed'),
                  );
                },
              },
            );
          }}
          aria-label={
            source.enabled
              ? t(locale, 'admin.discoverySources.toggleDisableAria', { name })
              : t(locale, 'admin.discoverySources.toggleEnableAria', { name })
          }
        />
      </div>
    </div>
  );
}

export function DiscoverySourcesPage() {
  const { locale } = useLocale();
  const sourcesQuery = useDiscoverySourcesQuery();

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
          {t(locale, 'admin.discoverySources.page.title')}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">{t(locale, 'admin.discoverySources.page.subtitle')}</p>
      </header>

      {sourcesQuery.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : sourcesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t(locale, 'admin.discoverySources.page.loadFailed')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{formatDiscoverySourcesApiError(sourcesQuery.error)}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => void sourcesQuery.refetch()}
            >
              {t(locale, 'content.common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <section className="flex flex-col">
          {(sourcesQuery.data?.items ?? []).map((source) => (
            <SourceRow key={source.sourceKey} source={source} />
          ))}
        </section>
      )}
    </div>
  );
}
