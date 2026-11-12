'use client';

import { t } from '@/i18n';
import type { DiscoverySourceSummary } from '@/shared/discovery';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type DiscoverSourcesProps = {
  sources: DiscoverySourceSummary[];
  selectedSourceKey: string | null;
  onSelect: (sourceKey: string) => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
};

const chipClassName = (isActive: boolean) =>
  cn(
    'inline-flex h-8 items-center rounded-full border px-3.5 text-sm transition-colors duration-200 ease-out-soft',
    'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
    isActive
      ? 'border-transparent bg-primary font-medium text-primary-foreground'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
  );

function sourceLabel(sourceKey: string, locale: Parameters<typeof t>[0]): string {
  const key = `admin.discoverySources.names.${sourceKey}`;
  const label = t(locale, key);
  return label === key ? sourceKey : label;
}

/** Discover source picker (multi-source ready; V1 may show a single enabled source). */
export function DiscoverSources({
  sources,
  selectedSourceKey,
  onSelect,
  isLoading = false,
  isError = false,
  onRetry,
}: DiscoverSourcesProps) {
  const { locale } = useLocale();

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2" aria-hidden>
        <Skeleton className="h-8 w-36 rounded-full bg-surface-container-high" />
      </div>
    );
  }

  if (isError && sources.length === 0) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{t(locale, 'content.discover.loadFailed')}</span>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onRetry}>
            {t(locale, 'content.common.retry')}
          </Button>
        ) : null}
      </div>
    );
  }

  if (sources.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t(locale, 'content.discover.sourcesAria')}>
      {sources.map((source) => (
        <button
          key={source.sourceKey}
          type="button"
          className={chipClassName(selectedSourceKey === source.sourceKey)}
          onClick={() => onSelect(source.sourceKey)}
          aria-pressed={selectedSourceKey === source.sourceKey}
        >
          {sourceLabel(source.sourceKey, locale)}
        </button>
      ))}
    </div>
  );
}

export { sourceLabel as discoverSourceLabel };
