'use client';

import { ChevronDown, Plug, Plus, Trash2, Wallet } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { type Locale, t } from '@gloaming/i18n';
import type { LlmApiFamily, LlmModel, LlmProvider, ProviderBalanceResult } from '@gloaming/shared/llm';
import { getWireFamilyDefinition, listWireFamilies } from '@gloaming/shared/llm';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs } from '@/components/ui/tabs';
import { formatAdminBalance } from '@/features/admin/admin-logs-format';
import { AdminSegmentedTabsList, AdminSegmentedTabsTrigger } from '@/features/admin/admin-segmented-tabs';
import { getApiFamilyLabel } from '@/features/admin/ai/ai-locale';
import { AiModelForm, type ModelFormValues } from '@/features/admin/ai/ai-model-form';
import { AiModelList } from '@/features/admin/ai/ai-model-list';
import { AiProviderForm, type ProviderFormValues } from '@/features/admin/ai/ai-provider-form';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

export type ProviderTestResult = {
  providerId: string;
  ok: boolean;
  message: string;
};

type FamilyFilter = 'all' | LlmApiFamily;

type CreateWizard = { step: 'family' } | { step: 'form'; apiFamily: LlmApiFamily };

type ModelFormState = {
  providerId: string;
  mode: 'create' | 'edit';
  model?: LlmModel;
};

type AiProviderWorkspaceProps = {
  providers: LlmProvider[];
  models: LlmModel[];
  onCreateProvider: (apiFamily: LlmApiFamily, values: ProviderFormValues) => Promise<LlmProvider>;
  onUpdateProvider: (provider: LlmProvider, values: ProviderFormValues) => Promise<void>;
  onToggleProviderEnabled: (provider: LlmProvider, isEnabled: boolean) => Promise<void>;
  onDeleteProvider: (provider: LlmProvider) => void;
  onCreateModel: (provider: LlmProvider, values: ModelFormValues) => Promise<void>;
  onUpdateModel: (model: LlmModel, values: ModelFormValues) => Promise<void>;
  onDeleteModel: (model: LlmModel) => void;
  onTestProvider: (provider: LlmProvider) => void;
  onQueryBalance: (provider: LlmProvider) => void;
  testingProviderId: string | null;
  togglingProviderId: string | null;
  testResult: ProviderTestResult | null;
  balanceByProvider: Record<string, ProviderBalanceResult>;
  queryingBalanceId: string | null;
  isProviderSaving?: boolean;
  isModelSaving?: boolean;
};

function formatBalance(result: ProviderBalanceResult, locale: Locale): string {
  if (!result.supported) {
    return '';
  }
  const amount = formatAdminBalance(result.balance, locale);
  return `${result.currency} ${amount}`;
}

function formatBaseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function isBalanceConfigured(provider: LlmProvider): boolean {
  return Boolean(provider.balanceEndpoint?.trim() && provider.balanceAmountPath?.trim());
}

function formatSummaryMeta(provider: LlmProvider, modelCount: number, familyLabel: string, locale: Locale): string {
  const parts = [
    formatBaseUrlHost(provider.baseUrl),
    familyLabel,
    t(locale, 'admin.ai.provider.modelsCount', { count: modelCount }),
  ];
  if (!getWireFamilyDefinition(provider.apiFamily).runtimeImplemented) {
    parts.push(t(locale, 'admin.ai.provider.runtimeNotSupported'));
  }
  return parts.join(' · ');
}

export function AiProviderWorkspace({
  providers,
  models,
  onCreateProvider,
  onUpdateProvider,
  onToggleProviderEnabled,
  onDeleteProvider,
  onCreateModel,
  onUpdateModel,
  onDeleteModel,
  onTestProvider,
  onQueryBalance,
  testingProviderId,
  togglingProviderId,
  testResult,
  balanceByProvider,
  queryingBalanceId,
  isProviderSaving,
  isModelSaving,
}: AiProviderWorkspaceProps) {
  const { locale } = useLocale();
  const providerFormId = useId();
  const modelFormId = useId();
  const families = listWireFamilies();

  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [createWizard, setCreateWizard] = useState<CreateWizard | null>(null);
  const [modelForm, setModelForm] = useState<ModelFormState | null>(null);

  const filteredProviders = useMemo(() => {
    if (familyFilter === 'all') {
      return providers;
    }
    return providers.filter((provider) => provider.apiFamily === familyFilter);
  }, [providers, familyFilter]);

  function toggleExpanded(providerId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
        setModelForm((current) => (current?.providerId === providerId ? null : current));
      } else {
        next.add(providerId);
      }
      return next;
    });
  }

  function startCreate() {
    setCreateWizard({ step: 'family' });
    setModelForm(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={familyFilter}
          className="w-fit"
          onValueChange={(value) => {
            if (value === 'all' || families.some((family) => family.id === value)) {
              setFamilyFilter(value as FamilyFilter);
            }
          }}
        >
          <AdminSegmentedTabsList aria-label={t(locale, 'admin.ai.provider.filterAria')}>
            <AdminSegmentedTabsTrigger value="all" className="px-3.5">
              {t(locale, 'admin.ai.provider.filterAll')}
            </AdminSegmentedTabsTrigger>
            {families.map((family) => (
              <AdminSegmentedTabsTrigger key={family.id} value={family.id} className="px-3.5">
                {getApiFamilyLabel(locale, family.id)}
              </AdminSegmentedTabsTrigger>
            ))}
          </AdminSegmentedTabsList>
        </Tabs>
        <Button className="h-9 rounded-xl px-4 hover:bg-brand-deep" onClick={startCreate}>
          <Plus data-icon="inline-start" />
          {t(locale, 'admin.ai.provider.add')}
        </Button>
      </div>

      {createWizard ? (
        <div className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-5 md:p-6">
          {createWizard.step === 'family' ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{t(locale, 'admin.ai.provider.selectFamilyHint')}</p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {families.map((family) => (
                  <li key={family.id}>
                    <button
                      type="button"
                      className="flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-secondary/40 p-4 text-left transition-colors hover:bg-secondary"
                      onClick={() => setCreateWizard({ step: 'form', apiFamily: family.id })}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{getApiFamilyLabel(locale, family.id)}</span>
                        {!family.runtimeImplemented ? (
                          <Badge variant="outline" className="text-xs font-normal">
                            {t(locale, 'admin.ai.provider.runtimeNotSupported')}
                          </Badge>
                        ) : null}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                className="w-fit rounded-xl"
                onClick={() => setCreateWizard(null)}
              >
                {t(locale, 'admin.content.common.cancel')}
              </Button>
            </div>
          ) : (
            <AiProviderForm
              key={`create-${createWizard.apiFamily}`}
              apiFamily={createWizard.apiFamily}
              provider={null}
              formId={providerFormId}
              onCancel={() => setCreateWizard({ step: 'family' })}
              onSubmit={async (values) => {
                if (createWizard.step !== 'form') {
                  return;
                }
                const created = await onCreateProvider(createWizard.apiFamily, values);
                setCreateWizard(null);
                setExpandedIds((prev) => new Set([...prev, created.id]));
              }}
            />
          )}
        </div>
      ) : null}

      {filteredProviders.length === 0 && !createWizard ? (
        <Empty className="rounded-2xl border border-dashed border-border bg-card py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Plus />
            </EmptyMedia>
            <EmptyTitle>{t(locale, 'admin.ai.provider.emptyTitle')}</EmptyTitle>
          </EmptyHeader>
          <Button className="mt-2 rounded-xl hover:bg-brand-deep" onClick={startCreate}>
            {t(locale, 'admin.ai.provider.add')}
          </Button>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {filteredProviders.map((provider) => {
            const familyDef = getWireFamilyDefinition(provider.apiFamily);
            const isExpanded = expandedIds.has(provider.id);
            const providerModels = models
              .filter((model) => model.providerId === provider.id)
              .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
            const resultForRow = testResult?.providerId === provider.id ? testResult : null;
            const balanceResult = balanceByProvider[provider.id];
            const isTesting = testingProviderId === provider.id;
            const isToggling = togglingProviderId === provider.id;
            const isQueryingBalance = queryingBalanceId === provider.id;
            const isModelFormOpen = modelForm?.providerId === provider.id;
            const hasBalanceConfig = isBalanceConfigured(provider);

            return (
              <li
                key={provider.id}
                className={cn(
                  'overflow-hidden rounded-2xl border border-border bg-card transition-opacity',
                  !provider.isEnabled && 'opacity-60',
                )}
              >
                <div className="px-4 py-3 md:px-5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpanded(provider.id)}
                    >
                      <ChevronDown
                        className={cn(
                          'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                          !isExpanded && '-rotate-90',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{provider.name}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {formatSummaryMeta(
                            provider,
                            providerModels.length,
                            getApiFamilyLabel(locale, provider.apiFamily),
                            locale,
                          )}
                        </p>
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-1">
                      <Switch
                        checked={provider.isEnabled}
                        disabled={isToggling}
                        aria-label={t(locale, 'admin.ai.provider.enabledAria', { name: provider.name })}
                        onCheckedChange={(checked) => {
                          void onToggleProviderEnabled(provider, checked);
                        }}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-xl"
                        disabled={isTesting || !familyDef.runtimeImplemented}
                        aria-label={t(locale, 'admin.ai.provider.testConnectivityAria')}
                        onClick={(event) => {
                          event.stopPropagation();
                          onTestProvider(provider);
                        }}
                      >
                        {isTesting ? <Spinner /> : <Plug className="size-4" />}
                      </Button>
                      {familyDef.provider.capabilities.balanceQuery ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn('relative size-8 rounded-xl', !hasBalanceConfig && 'text-muted-foreground')}
                          disabled={isQueryingBalance}
                          aria-label={t(locale, 'admin.ai.provider.queryBalanceAria')}
                          onClick={(event) => {
                            event.stopPropagation();
                            onQueryBalance(provider);
                          }}
                        >
                          {isQueryingBalance ? <Spinner /> : <Wallet className="size-4" />}
                          {hasBalanceConfig ? (
                            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-brand-deep" />
                          ) : null}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {resultForRow || balanceResult ? (
                    <div className="mt-2 border-t border-border/60 pt-2 text-xs">
                      {resultForRow ? (
                        <p className={resultForRow.ok ? 'text-muted-foreground' : 'text-destructive'}>
                          {resultForRow.message}
                        </p>
                      ) : null}
                      {balanceResult?.supported ? (
                        <p className="text-muted-foreground">{formatBalance(balanceResult, locale)}</p>
                      ) : balanceResult && !balanceResult.supported ? (
                        <p className="text-muted-foreground">{balanceResult.message}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {isExpanded ? (
                  <div className="flex flex-col gap-6 border-t border-border px-4 py-5 md:px-5">
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-xl text-destructive hover:text-destructive"
                        aria-label={t(locale, 'admin.ai.provider.deleteProviderAria')}
                        onClick={() => onDeleteProvider(provider)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>

                    <AiProviderForm
                      key={provider.id}
                      apiFamily={provider.apiFamily}
                      provider={provider}
                      formId={`${providerFormId}-${provider.id}`}
                      onSubmit={(values) => onUpdateProvider(provider, values)}
                    />

                    <section className="flex flex-col gap-4 border-t border-border pt-5">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-base font-medium">{t(locale, 'admin.ai.provider.modelsSection')}</h4>
                        {!isModelFormOpen ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-8 rounded-xl"
                            aria-label={t(locale, 'admin.ai.provider.addModelAria')}
                            onClick={() => setModelForm({ providerId: provider.id, mode: 'create' })}
                          >
                            <Plus className="size-4" />
                          </Button>
                        ) : null}
                      </div>

                      {isModelFormOpen ? (
                        <AiModelForm
                          key={modelForm.mode === 'edit' ? modelForm.model?.id : `${provider.id}-create`}
                          formId={`${modelFormId}-${provider.id}`}
                          provider={provider}
                          model={modelForm.mode === 'edit' ? (modelForm.model ?? null) : null}
                          onCancel={() => setModelForm(null)}
                          onSubmit={async (values) => {
                            if (modelForm.mode === 'edit' && modelForm.model) {
                              await onUpdateModel(modelForm.model, values);
                            } else {
                              await onCreateModel(provider, values);
                            }
                            setModelForm(null);
                          }}
                        />
                      ) : (
                        <AiModelList
                          provider={provider}
                          models={providerModels}
                          onEdit={(model) => setModelForm({ providerId: provider.id, mode: 'edit', model })}
                          onDelete={onDeleteModel}
                        />
                      )}
                    </section>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {(isProviderSaving || isModelSaving) && (
        <p className="text-sm text-muted-foreground">{t(locale, 'admin.content.common.saving')}</p>
      )}
    </div>
  );
}
