'use client';

import { Wallet } from 'lucide-react';
import { useState } from 'react';

import type { LlmProvider, ProviderBalanceResult } from '@gloaming/shared/llm';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { queryLlmProviderBalance } from '@/features/admin/ai/ai-config-api';

function formatBalance(result: ProviderBalanceResult): string {
  if (!result.supported) {
    return '';
  }
  const amount = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(result.balance);
  return `${result.currency} ${amount}`;
}

export function AiProviderBalanceCards({ providers }: { providers: LlmProvider[] }) {
  const [results, setResults] = useState<Record<string, ProviderBalanceResult>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function queryBalance(provider: LlmProvider) {
    setLoadingId(provider.id);
    try {
      const result = await queryLlmProviderBalance(provider.id);
      setResults((prev) => ({ ...prev, [provider.id]: result }));
    } catch (error) {
      setResults((prev) => ({
        ...prev,
        [provider.id]: {
          supported: false,
          reason: 'request-failed',
          message: error instanceof Error ? error.message : '查询失败',
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
          <h2 className="text-base font-medium text-foreground">服务商余额</h2>
          <p className="mt-1 text-sm text-muted-foreground">来自各服务商余额接口，点击卡片按钮查询。</p>
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
                    {formatBalance(result)}
                  </Badge>
                ) : null}
              </div>
              <div className="flex min-h-6 flex-wrap items-center gap-2">
                {result?.supported ? (
                  <>
                    {result.isAvailable != null ? (
                      <span className="text-xs text-muted-foreground">
                        {result.isAvailable ? '可调用' : '余额不足'}
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
                      刷新
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
                      重试
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
                        查询中
                      </>
                    ) : (
                      <>
                        <Wallet data-icon="inline-start" />
                        查询余额
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
