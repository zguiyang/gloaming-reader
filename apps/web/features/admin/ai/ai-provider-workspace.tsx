'use client';

import { Plug, Plus, Trash2, Wallet } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { type Locale, t } from '@gloaming/i18n';
import type { LlmApiFamily, LlmModel, LlmProvider, ProviderBalanceResult } from '@gloaming/shared/llm';
import { getWireFamilyDefinition, listWireFamilies } from '@gloaming/shared/llm';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { formatAdminBalance } from '@/features/admin/admin-logs-format';
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
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [createWizard, setCreateWizard] = useState<CreateWizard | null>(null);
  const [modelForm, setModelForm] = useState<ModelFormState | null>(null);
  // Single editing context: the provider form and the model form never coexist.
  const [isEditingProvider, setIsEditingProvider] = useState(false);

  const filteredProviders = useMemo(() => {
    if (familyFilter === 'all') {
      return providers;
    }
    return providers.filter((provider) => provider.apiFamily === familyFilter);
  }, [providers, familyFilter]);

  // One selected provider at a time; keep the selection valid after refetch.
  const activeProvider =
    filteredProviders.find((provider) => provider.id === selectedProviderId) ??
    (createWizard ? null : (filteredProviders[0] ?? null));

  function selectProvider(providerId: string) {
    setModelForm(null);
    setCreateWizard(null);
    setIsEditingProvider(false);
    setSelectedProviderId(providerId);
  }

  function startCreate() {
    setCreateWizard({ step: 'family' });
    setModelForm(null);
    setIsEditingProvider(false);
    setSelectedProviderId(null);
  }

  const filterItems = [
    { value: 'all', label: t(locale, 'admin.ai.provider.filterAll') },
    ...families.map((family) => ({ value: family.id, label: getApiFamilyLabel(locale, family.id) })),
  ];

  const workspace = createWizard ? null : activeProvider;

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-8">
      {/* Provider list column */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h3 className="text-base font-semibold text-foreground">{t(locale, 'admin.ai.provider.listTitle')}</h3>
            <span className="text-sm text-muted-foreground">{providers.length}</span>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl" onClick={startCreate}>
            <Plus data-icon="inline-start" />
            {t(locale, 'admin.ai.provider.add')}
          </Button>
        </div>

        <Select
          items={filterItems}
          value={familyFilter}
          onValueChange={(value) => {
            if (value && (value === 'all' || families.some((family) => family.id === value))) {
              setFamilyFilter(value as FamilyFilter);
              setModelForm(null);
            }
          }}
        >
          <SelectTrigger
            aria-label={t(locale, 'admin.ai.provider.filterAria')}
            appearance="filled"
            size="sm"
            className="w-full rounded-lg"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {filterItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        {filteredProviders.length === 0 && !createWizard ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {t(locale, 'admin.ai.provider.emptyTitle')}
          </p>
        ) : (
          <ul className="flex flex-col">
            {filteredProviders.map((provider) => {
              const providerModels = models.filter((model) => model.providerId === provider.id);
              const isActive = activeProvider?.id === provider.id && !createWizard;
              const isToggling = togglingProviderId === provider.id;
              return (
                <li key={provider.id}>
                  <div
                    className={cn(
                      'flex items-center gap-2 border-b border-border/50 py-3 pr-1',
                      isActive && 'bg-brand-soft/40',
                    )}
                  >
                    <button
                      type="button"
                      className={cn(
                        'flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg px-2 py-1 text-left',
                        isActive && 'border-l-2 border-primary pl-2.5',
                      )}
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => selectProvider(provider.id)}
                    >
                      <span className="truncate text-sm font-medium text-foreground">{provider.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {formatSummaryMeta(
                          provider,
                          providerModels.length,
                          getApiFamilyLabel(locale, provider.apiFamily),
                          locale,
                        )}
                      </span>
                    </button>
                    <Switch
                      checked={provider.isEnabled}
                      disabled={isToggling}
                      aria-label={t(locale, 'admin.ai.provider.enabledAria', { name: provider.name })}
                      onCheckedChange={(checked) => {
                        void onToggleProviderEnabled(provider, checked);
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!createWizard && !providers.length ? (
          <Button type="button" variant="outline" className="h-9 w-fit rounded-xl" onClick={startCreate}>
            <Plus data-icon="inline-start" />
            {t(locale, 'admin.ai.provider.add')}
          </Button>
        ) : null}
      </div>

      {/* Workspace column */}
      <div className="flex flex-col gap-8">
        {createWizard ? (
          <div className="flex flex-col gap-5">
            {createWizard.step === 'family' ? (
              <div className="flex flex-col gap-4">
                <h3 className="text-base font-semibold text-foreground">{t(locale, 'admin.ai.provider.add')}</h3>
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
              <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 md:p-6">
                <h3 className="text-base font-semibold text-foreground">{t(locale, 'admin.ai.provider.add')}</h3>
                <AiProviderForm
                  key={`create-${createWizard.apiFamily}`}
                  apiFamily={createWizard.apiFamily}
                  provider={null}
                  formId={providerFormId}
                  pending={isProviderSaving}
                  onCancel={() => setCreateWizard({ step: 'family' })}
                  onSubmit={async (values) => {
                    if (createWizard.step !== 'form') {
                      return;
                    }
                    const created = await onCreateProvider(createWizard.apiFamily, values);
                    setCreateWizard(null);
                    setSelectedProviderId(created.id);
                  }}
                />
              </div>
            )}
          </div>
        ) : workspace ? (
          (() => {
            const familyDef = getWireFamilyDefinition(workspace.apiFamily);
            const resultForRow = testResult?.providerId === workspace.id ? testResult : null;
            const balanceResult = balanceByProvider[workspace.id];
            const isTesting = testingProviderId === workspace.id;
            const isQueryingBalance = queryingBalanceId === workspace.id;
            const hasBalanceConfig = isBalanceConfigured(workspace);

            return (
              <div className="flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <h3 className="truncate text-lg font-semibold text-foreground">{workspace.name}</h3>
                    <Badge variant="secondary" className="text-xs font-normal">
                      {getApiFamilyLabel(locale, workspace.apiFamily)}
                    </Badge>
                    {!familyDef.runtimeImplemented ? (
                      <Badge variant="outline" className="text-xs font-normal">
                        {t(locale, 'admin.ai.provider.runtimeNotSupported')}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-xl"
                      disabled={isTesting || !familyDef.runtimeImplemented}
                      aria-label={t(locale, 'admin.ai.provider.testConnectivityAria')}
                      onClick={() => onTestProvider(workspace)}
                    >
                      {isTesting ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Plug data-icon="inline-start" className="size-4" />
                      )}
                      {t(locale, 'admin.ai.provider.testConnectivity')}
                    </Button>
                    {familyDef.provider.capabilities.balanceQuery ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn('rounded-xl', !hasBalanceConfig && 'text-muted-foreground')}
                        disabled={isQueryingBalance}
                        aria-label={t(locale, 'admin.ai.provider.queryBalanceAria')}
                        onClick={() => onQueryBalance(workspace)}
                      >
                        {isQueryingBalance ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Wallet data-icon="inline-start" className="size-4" />
                        )}
                        {t(locale, 'admin.ai.provider.queryBalance')}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 rounded-xl text-destructive hover:text-destructive"
                      aria-label={t(locale, 'admin.ai.provider.deleteProviderAria')}
                      onClick={() => onDeleteProvider(workspace)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                {(resultForRow || balanceResult) && (
                  <div className="flex flex-col gap-1 text-xs">
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
                )}

                <p className="text-xs text-muted-foreground">{t(locale, 'admin.ai.provider.savedConfigOnly')}</p>

                {/* Single editing context: provider summary + explicit edit entry,
                    or the provider form — never the provider form alongside the model editor. */}
                {isEditingProvider ? (
                  <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 md:p-6">
                    <AiProviderForm
                      key={`edit-${workspace.id}`}
                      apiFamily={workspace.apiFamily}
                      provider={workspace}
                      formId={`${providerFormId}-${workspace.id}`}
                      pending={isProviderSaving}
                      onCancel={() => setIsEditingProvider(false)}
                      onSubmit={(values) => onUpdateProvider(workspace, values)}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 border-b border-border/50 pb-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <dl className="grid min-w-0 flex-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <dt className="text-xs text-muted-foreground">{t(locale, 'admin.ai.provider.form.name')}</dt>
                          <dd className="truncate text-sm text-foreground">{workspace.name}</dd>
                        </div>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <dt className="text-xs text-muted-foreground">
                            {t(locale, 'admin.ai.provider.form.baseUrl')}
                          </dt>
                          <dd className="truncate font-mono text-sm text-foreground">{workspace.baseUrl}</dd>
                        </div>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <dt className="text-xs text-muted-foreground">
                            {t(locale, 'admin.ai.provider.form.apiKey')}
                          </dt>
                          <dd className="truncate text-sm text-foreground">
                            {workspace.apiKeySet
                              ? `${t(locale, 'common.secret.configured')} · ${workspace.apiKeyMasked ?? '••••'}`
                              : t(locale, 'admin.content.common.notFilled')}
                          </dd>
                        </div>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <dt className="text-xs text-muted-foreground">{t(locale, 'admin.ai.provider.form.proxy')}</dt>
                          <dd className="truncate font-mono text-sm text-foreground">
                            {workspace.proxyUrl || t(locale, 'admin.content.common.notFilled')}
                          </dd>
                        </div>
                      </dl>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 shrink-0 rounded-xl"
                        onClick={() => {
                          setModelForm(null);
                          setIsEditingProvider(true);
                        }}
                      >
                        {t(locale, 'admin.content.common.edit')}
                      </Button>
                    </div>
                  </div>
                )}

                <section className="flex flex-col gap-4 border-t border-border/60 pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-baseline gap-2">
                      <h4 className="text-base font-semibold text-foreground">
                        {t(locale, 'admin.ai.provider.modelsSection')}
                      </h4>
                      <span className="text-sm text-muted-foreground">
                        {models.filter((model) => model.providerId === workspace.id).length}
                      </span>
                    </div>
                    {!modelForm && !isEditingProvider ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-xl"
                        onClick={() => {
                          setIsEditingProvider(false);
                          setModelForm({ providerId: workspace.id, mode: 'create' });
                        }}
                      >
                        <Plus data-icon="inline-start" />
                        {t(locale, 'admin.ai.model.addModel')}
                      </Button>
                    ) : null}
                  </div>

                  {modelForm && modelForm.providerId === workspace.id ? (
                    <AiModelForm
                      key={modelForm.mode === 'edit' ? modelForm.model?.id : `${workspace.id}-create`}
                      formId={`${modelFormId}-${workspace.id}`}
                      provider={workspace}
                      model={modelForm.mode === 'edit' ? (modelForm.model ?? null) : null}
                      pending={isModelSaving}
                      onCancel={() => setModelForm(null)}
                      onSubmit={async (values) => {
                        if (modelForm.mode === 'edit' && modelForm.model) {
                          await onUpdateModel(modelForm.model, values);
                        } else {
                          await onCreateModel(workspace, values);
                        }
                        setModelForm(null);
                      }}
                    />
                  ) : (
                    <AiModelList
                      provider={workspace}
                      models={models
                        .filter((model) => model.providerId === workspace.id)
                        .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))}
                      onEdit={(model) => {
                        setIsEditingProvider(false);
                        setModelForm({ providerId: workspace.id, mode: 'edit', model });
                      }}
                      onDelete={onDeleteModel}
                    />
                  )}
                </section>
              </div>
            );
          })()
        ) : (
          <Empty className="rounded-2xl border border-dashed border-border py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Plus />
              </EmptyMedia>
              <EmptyTitle>{t(locale, 'admin.ai.provider.emptyTitle')}</EmptyTitle>
            </EmptyHeader>
            <Button type="button" variant="outline" className="mt-2 rounded-xl" onClick={startCreate}>
              <Plus data-icon="inline-start" />
              {t(locale, 'admin.ai.provider.add')}
            </Button>
          </Empty>
        )}

        {(isProviderSaving || isModelSaving) && (
          <p className="text-sm text-muted-foreground">{t(locale, 'admin.content.common.saving')}</p>
        )}
      </div>
    </div>
  );
}
