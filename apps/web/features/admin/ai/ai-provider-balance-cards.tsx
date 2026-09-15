'use client';

import { Wallet } from 'lucide-react';
import { useState } from 'react';

import { t } from '@gloaming/i18n';
import type { LlmProvider, ProviderBalanceResult } from '@gloaming/shared/llm';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { formatAdminBalance } from '@/features/admin/admin-logs-format';
import { queryLlmProviderBalance } from '@/features/admin/ai/ai-config-api';
import { useLocale } from '@/lib/locale-context';

export function AiProviderBalanceCards({ providers }: { providers: LlmProvider[] }) {
  const { locale } = useLocale();
  const [results, setResults] = useState<Record<string, ProviderBalanceResult>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function queryBalance(provider: LlmProvider) {
    setLoadingId(provider.id);
    try {
      const result = await queryLlmProviderBalance(provider.id);
      setResults((prev) => ({ ...prev, [provider.id]: result }));
    } catch {
      setResults((prev) => ({
        ...prev,
        [provider.id]: {
          supported: false,
          reason: 'request-failed',
          message: t(locale, 'admin.logs.ai.providerQueryFailed'),
        },
      }));
    } finally {
      setLoadingId(null);
    }
  }

  const enabledProviders = providers.filter((provider) => provider.isEnabled);

  if (enabledProviders.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-foreground">{t(locale, 'admin.logs.ai.providerBalancesTitle')}</h2>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {enabledProviders.map((provider) => {
          const result = results[provider.id];
          const isLoading = loadingId === provider.id;
          return (
            <div key={provider.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground">{provider.name}</p>
                {result?.supported ? (
                  <Badge variant="secondary" className="gap-1 text-xs tabular-nums">
                    <Wallet data-icon="inline-start" />
                    {`${result.currency} ${formatAdminBalance(result.balance, locale)}`}
                  </Badge>
                ) : null}
              </div>
              <div className="flex min-h-6 flex-wrap items-center gap-2">
                {result?.supported ? (
                  <>
                    {result.isAvailable != null ? (
                      <span className="text-xs text-muted-foreground">
                        {result.isAvailable
                          ? t(locale, 'admin.logs.ai.providerAvailable')
                          : t(locale, 'admin.logs.ai.providerInsufficient')}
                      </span>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 rounded-lg px-2 text-xs"
                      disabled={isLoading}
                      onClick={() => queryBalance(provider)}
                    >
                      {isLoading ? <Spinner data-icon="inline-start" /> : null}
                      {t(locale, 'admin.logs.ai.providerRefresh')}
                    </Button>
                  </>
                ) : result && !result.supported ? (
                  <>
                    <span className="text-xs text-muted-foreground">{result.message}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 rounded-lg px-2 text-xs"
                      disabled={isLoading}
                      onClick={() => queryBalance(provider)}
                    >
                      {isLoading ? <Spinner data-icon="inline-start" /> : null}
                      {t(locale, 'admin.logs.ai.providerRetry')}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-lg px-2.5 text-xs"
                    disabled={isLoading}
                    onClick={() => queryBalance(provider)}
                  >
                    {isLoading ? (
                      <>
                        <Spinner data-icon="inline-start" />
                        {t(locale, 'admin.logs.ai.providerQuerying')}
                      </>
                    ) : (
                      <>
                        <Wallet data-icon="inline-start" />
                        {t(locale, 'admin.logs.ai.providerQueryBalance')}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
