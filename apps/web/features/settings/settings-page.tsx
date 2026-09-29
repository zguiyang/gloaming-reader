'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import {
  type AiSettingKey,
  LLM_API_FAMILIES,
  LLM_WIRE_REGISTRY,
  type LlmApiFamily,
  type LlmModel,
  type LlmProvider,
} from '@gloaming/shared/llm';

import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthDialog } from '@/features/auth';
import {
  createUserLlmModel,
  createUserLlmProvider,
  deleteUserLlmModel,
  deleteUserLlmProvider,
  formatUserSettingsApiError,
  getUserTtsConfig,
  listUserLlmModels,
  listUserLlmProviders,
  listUserLlmSettings,
  putUserLlmSetting,
  updateUserLlmModel,
  updateUserLlmProvider,
  userSettingsQueryKey,
} from '@/features/settings/settings-api';
import { SettingsTtsSection } from '@/features/settings/tts/settings-tts-section';
import { authClient } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';

type ProviderDraft = {
  apiFamily: LlmApiFamily;
  name: string;
  baseUrl: string;
  apiKey: string;
  proxyUrl: string;
  thinkingParam: string;
};
type ModelDraft = { modelId: string; label: string; wireVariant: string };

const EMPTY_PROVIDER: ProviderDraft = {
  apiFamily: 'openai',
  name: '',
  baseUrl: '',
  apiKey: '',
  proxyUrl: '',
  thinkingParam: '',
};
const EMPTY_MODEL: ModelDraft = { modelId: '', label: '', wireVariant: 'chat-completions' };
const PURPOSES: Array<{ key: AiSettingKey; labelKey: string }> = [
  { key: 'assist.default_model_id', labelKey: 'assist' },
  { key: 'translate.default_model_id', labelKey: 'translate' },
  { key: 'metadata-enrich.default_model_id', labelKey: 'metadata' },
];

function SettingHeader() {
  const { locale } = useLocale();
  return (
    <header className="mb-6 border-b border-border/40 pb-4">
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
        {t(locale, 'settings.title')}
      </h1>
    </header>
  );
}

function ProviderForm({
  provider,
  onSave,
  pending,
}: {
  provider: LlmProvider | null;
  onSave: (draft: ProviderDraft) => void;
  pending: boolean;
}) {
  const { locale } = useLocale();
  const [draft, setDraft] = useState<ProviderDraft>(() =>
    provider
      ? {
          apiFamily: provider.apiFamily,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: '',
          proxyUrl: provider.proxyUrl ?? '',
          thinkingParam: provider.thinkingParam ?? '',
        }
      : EMPTY_PROVIDER,
  );
  const [errors, setErrors] = useState<Partial<Record<keyof ProviderDraft, string>>>({});

  const family = LLM_WIRE_REGISTRY[draft.apiFamily];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!draft.name.trim()) next.name = t(locale, 'settings.validation.required');
    try {
      new URL(draft.baseUrl.trim());
    } catch {
      next.baseUrl = t(locale, 'settings.validation.url');
    }
    if (!provider && !draft.apiKey.trim()) next.apiKey = t(locale, 'settings.validation.required');
    setErrors(next);
    if (Object.keys(next).length === 0) onSave(draft);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <FieldGroup className="gap-4">
        {!provider ? (
          <Field>
            <FieldLabel htmlFor="settings-provider-family">{t(locale, 'settings.ai.serviceType')}</FieldLabel>
            <select
              id="settings-provider-family"
              className="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              value={draft.apiFamily}
              onChange={(event) => {
                const apiFamily = event.target.value as LlmApiFamily;
                setDraft((current) => ({ ...current, apiFamily }));
              }}
            >
              {LLM_API_FAMILIES.map((familyId) => (
                <option key={familyId} value={familyId}>
                  {LLM_WIRE_REGISTRY[familyId].label}
                  {!LLM_WIRE_REGISTRY[familyId].runtimeImplemented
                    ? ` · ${t(locale, 'settings.ai.notAvailableYet')}`
                    : ''}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.name) || undefined}>
            <FieldLabel htmlFor="settings-provider-name">{t(locale, 'settings.ai.providerName')}</FieldLabel>
            <Input
              id="settings-provider-name"
              value={draft.name}
              onChange={(e) => setDraft((v) => ({ ...v, name: e.target.value }))}
            />
            <FieldError>{errors.name}</FieldError>
          </Field>
          <Field data-invalid={Boolean(errors.baseUrl) || undefined}>
            <FieldLabel htmlFor="settings-provider-url">{t(locale, 'settings.ai.baseUrl')}</FieldLabel>
            <Input
              id="settings-provider-url"
              type="url"
              placeholder={family.provider.baseUrlPlaceholder}
              value={draft.baseUrl}
              onChange={(e) => setDraft((v) => ({ ...v, baseUrl: e.target.value }))}
            />
            <FieldError>{errors.baseUrl}</FieldError>
          </Field>
        </div>
        <Field data-invalid={Boolean(errors.apiKey) || undefined}>
          <FieldLabel htmlFor="settings-provider-key">
            {t(locale, 'settings.ai.apiKey')}
            {provider?.apiKeySet ? ` · ${provider.apiKeyMasked ?? t(locale, 'settings.secret.saved')}` : ''}
          </FieldLabel>
          <Input
            id="settings-provider-key"
            type="password"
            autoComplete="new-password"
            value={draft.apiKey}
            placeholder={provider?.apiKeySet ? t(locale, 'settings.secret.leaveBlank') : ''}
            onChange={(e) => setDraft((v) => ({ ...v, apiKey: e.target.value }))}
          />
          <FieldError>{errors.apiKey}</FieldError>
        </Field>
        <details className="border-t border-border/50 pt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {t(locale, 'settings.ai.advanced')}
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="settings-provider-proxy">{t(locale, 'settings.ai.proxyUrl')}</FieldLabel>
              <Input
                id="settings-provider-proxy"
                type="url"
                value={draft.proxyUrl}
                onChange={(e) => setDraft((v) => ({ ...v, proxyUrl: e.target.value }))}
              />
            </Field>
            {family.provider.optionalFields.includes('thinkingParam') ? (
              <Field>
                <FieldLabel htmlFor="settings-provider-thinking-param">
                  {t(locale, 'settings.ai.thinkingParam')}
                </FieldLabel>
                <Input
                  id="settings-provider-thinking-param"
                  value={draft.thinkingParam}
                  onChange={(e) => setDraft((v) => ({ ...v, thinkingParam: e.target.value }))}
                />
              </Field>
            ) : null}
          </div>
        </details>
      </FieldGroup>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t(locale, 'settings.saving') : t(locale, 'settings.save')}
        </Button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const { locale } = useLocale();
  const { openLogin } = useAuthDialog();
  const session = authClient.useSession();
  const queryClient = useQueryClient();
  const providersQuery = useQuery({
    queryKey: userSettingsQueryKey.providers(),
    queryFn: ({ signal }) => listUserLlmProviders(signal),
    enabled: Boolean(session.data?.user),
  });
  const settingsQuery = useQuery({
    queryKey: userSettingsQueryKey.settings(),
    queryFn: ({ signal }) => listUserLlmSettings(signal),
    enabled: Boolean(session.data?.user),
  });
  const ttsQuery = useQuery({
    queryKey: userSettingsQueryKey.tts(),
    queryFn: ({ signal }) => getUserTtsConfig(signal),
    enabled: Boolean(session.data?.user),
  });
  const providers = providersQuery.data ?? [];
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const activeProviderId = providers.some((provider) => provider.id === selectedProviderId)
    ? selectedProviderId
    : (providers[0]?.id ?? '');
  const modelsQueries = useQueries({
    queries: providers.map((provider) => ({
      queryKey: [...userSettingsQueryKey.models(), provider.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => listUserLlmModels(provider.id, signal),
    })),
  });
  const models = useMemo(() => modelsQueries.flatMap((query) => query.data ?? []), [modelsQueries]);
  const [isProviderFormOpen, setIsProviderFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LlmProvider | null>(null);
  const [modelDraft, setModelDraft] = useState<ModelDraft>(EMPTY_MODEL);
  const [editingModelId, setEditingModelId] = useState('');
  const [aiModeDraft, setAiModeDraft] = useState<'default' | 'own' | null>(null);
  const [purposeDraft, setPurposeDraft] = useState<Partial<Record<AiSettingKey, string>>>({});
  const isOwnMode = providers.some((provider) => provider.isEnabled);
  const settings = settingsQuery.data ?? [];
  const loadError = providersQuery.error ?? settingsQuery.error ?? ttsQuery.error;

  useEffect(() => {
    if (!session.isPending && session.error?.status === 401) openLogin();
  }, [openLogin, session.error?.status, session.isPending]);

  async function refreshLlm() {
    await queryClient.invalidateQueries({ queryKey: [...userSettingsQueryKey.all, 'llm'] });
  }

  const providerMutation = useMutation({
    mutationFn: async ({ draft, current }: { draft: ProviderDraft; current: LlmProvider | null }) =>
      current
        ? updateUserLlmProvider(current.id, {
            name: draft.name.trim(),
            baseUrl: draft.baseUrl.trim(),
            proxyUrl: draft.proxyUrl.trim() || null,
            thinkingParam: draft.thinkingParam.trim() || null,
            ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
          })
        : createUserLlmProvider({
            apiFamily: draft.apiFamily,
            name: draft.name.trim(),
            baseUrl: draft.baseUrl.trim(),
            apiKey: draft.apiKey.trim(),
            proxyUrl: draft.proxyUrl.trim() || null,
            thinkingParam: draft.thinkingParam.trim() || null,
            balanceEndpoint: null,
            balanceAmountPath: null,
            balanceCurrencyPath: null,
            isEnabled: true,
          }),
    onSuccess: async () => {
      await refreshLlm();
      setIsProviderFormOpen(false);
      setEditingProvider(null);
      toast.success(t(locale, 'settings.saved'));
    },
    onError: (error) => toast.error(formatUserSettingsApiError(error)),
  });

  const modelMutation = useMutation({
    mutationFn: async ({ draft, model }: { draft: ModelDraft; model: LlmModel | null }) => {
      if (model)
        return updateUserLlmModel(model.id, {
          modelId: draft.modelId.trim(),
          label: draft.label.trim(),
          wireVariant: draft.wireVariant,
        });
      const provider = providers.find((item) => item.id === activeProviderId);
      if (!provider) throw new Error(t(locale, 'settings.ai.providerRequired'));
      return createUserLlmModel({
        providerId: provider.id,
        modelId: draft.modelId.trim(),
        label: draft.label.trim(),
        wireVariant: draft.wireVariant,
        isEnabled: true,
        sortOrder: 0,
      });
    },
    onSuccess: async () => {
      await refreshLlm();
      setModelDraft(EMPTY_MODEL);
      setEditingModelId('');
      toast.success(t(locale, 'settings.saved'));
    },
    onError: (error) => toast.error(formatUserSettingsApiError(error)),
  });

  const modeMutation = useMutation({
    mutationFn: async (mode: 'default' | 'own') => {
      const isEnabled = mode === 'own';
      await Promise.all(
        providers
          .filter((provider) => provider.isEnabled !== isEnabled)
          .map((provider) => updateUserLlmProvider(provider.id, { isEnabled })),
      );
    },
    onSuccess: async () => {
      await refreshLlm();
      setAiModeDraft(null);
      toast.success(t(locale, 'settings.saved'));
    },
    onError: (error) => toast.error(formatUserSettingsApiError(error)),
  });

  const settingMutation = useMutation({
    mutationFn: ({ key, modelId }: { key: AiSettingKey; modelId: string }) => putUserLlmSetting(key, { modelId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userSettingsQueryKey.settings() });
      toast.success(t(locale, 'settings.saved'));
    },
    onError: (error) => toast.error(formatUserSettingsApiError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ kind, id }: { kind: 'provider' | 'model'; id: string }) =>
      kind === 'provider' ? deleteUserLlmProvider(id) : deleteUserLlmModel(id),
    onSuccess: async () => {
      await refreshLlm();
      toast.success(t(locale, 'settings.saved'));
    },
    onError: (error) => toast.error(formatUserSettingsApiError(error)),
  });

  if (!session.data?.user && session.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <SettingHeader />
        <div className="h-24 animate-pulse rounded bg-surface-container-high" />
      </div>
    );
  }
  if (!session.data?.user) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <SettingHeader />
        <p className="text-sm text-muted-foreground">{t(locale, 'settings.signInRequired')}</p>
      </div>
    );
  }

  const modelsByProvider = models.filter((model) => model.providerId === activeProviderId);
  const currentProvider = editingProvider;
  const ttsConfig = ttsQuery.data;

  return (
    <div className="mx-auto w-full max-w-3xl pb-8">
      <SettingHeader />
      <Tabs defaultValue="ai">
        <TabsList aria-label={t(locale, 'settings.tabsAria')}>
          <TabsTrigger value="ai">{t(locale, 'settings.ai.title')}</TabsTrigger>
          <TabsTrigger value="tts">{t(locale, 'settings.tts.title')}</TabsTrigger>
        </TabsList>
        <TabsContent value="ai" className="pt-6">
          {providersQuery.isPending || settingsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">{t(locale, 'settings.loading')}</p>
          ) : null}
          {loadError ? (
            <p role="alert" className="text-sm text-destructive">
              {formatUserSettingsApiError(loadError)}
            </p>
          ) : null}
          {!providersQuery.isPending && !settingsQuery.isPending && !loadError ? (
            <div className="flex flex-col gap-6">
              <section>
                <h2 className="font-heading text-xl font-semibold">{t(locale, 'settings.ai.service')}</h2>
                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t(locale, 'settings.serviceMode')}>
                  <Button
                    type="button"
                    variant={!isOwnMode ? 'default' : 'outline'}
                    onClick={() => setAiModeDraft('default')}
                  >
                    {t(locale, 'settings.defaultService')}
                  </Button>
                  <Button
                    type="button"
                    variant={isOwnMode ? 'default' : 'outline'}
                    onClick={() => setAiModeDraft('own')}
                  >
                    {t(locale, 'settings.ownApi')}
                  </Button>
                </div>
                {!providers.length ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-muted-foreground">{t(locale, 'settings.ai.noProviders')}</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingProvider(null);
                        setIsProviderFormOpen(true);
                      }}
                    >
                      {t(locale, 'settings.ai.addProvider')}
                    </Button>
                  </div>
                ) : null}
                {!providers.length && isProviderFormOpen ? (
                  <div className="mt-4">
                    <ProviderForm
                      key="new-provider"
                      provider={null}
                      pending={providerMutation.isPending}
                      onSave={(draft) => providerMutation.mutate({ draft, current: null })}
                    />
                  </div>
                ) : null}
                {aiModeDraft ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-muted-foreground">
                      {t(locale, aiModeDraft === 'default' ? 'settings.ai.confirmDefault' : 'settings.ai.confirmOwn')}
                    </p>
                    <Button
                      type="button"
                      disabled={modeMutation.isPending || providers.length === 0}
                      onClick={() => modeMutation.mutate(aiModeDraft)}
                    >
                      {t(locale, 'settings.save')}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setAiModeDraft(null)}>
                      {t(locale, 'settings.cancel')}
                    </Button>
                  </div>
                ) : null}
              </section>

              {isOwnMode ? (
                <section className="border-t border-border/60 pt-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h2 className="font-heading text-xl font-semibold">{t(locale, 'settings.ai.providers')}</h2>
                    {!isProviderFormOpen ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditingProvider(null);
                          setIsProviderFormOpen(true);
                        }}
                      >
                        {t(locale, 'settings.ai.addProvider')}
                      </Button>
                    ) : null}
                  </div>
                  {providers.length ? (
                    <div className="mt-4 flex flex-col gap-4">
                      {providers.map((provider) => (
                        <div key={provider.id} className="border-b border-border/50 pb-4 last:border-0">
                          <div className="mb-3 flex flex-wrap items-center gap-3">
                            <h3 className="font-medium">{provider.name}</h3>
                            <span className="text-sm text-muted-foreground">
                              {LLM_WIRE_REGISTRY[provider.apiFamily].label}
                            </span>
                            {!LLM_WIRE_REGISTRY[provider.apiFamily].runtimeImplemented ? (
                              <span className="text-sm text-muted-foreground">
                                {t(locale, 'settings.ai.notAvailableYet')}
                              </span>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingProvider(provider);
                                setIsProviderFormOpen(true);
                              }}
                            >
                              {t(locale, 'settings.edit')}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={deleteMutation.isPending}
                              onClick={() => deleteMutation.mutate({ kind: 'provider', id: provider.id })}
                            >
                              {t(locale, 'settings.delete')}
                            </Button>
                          </div>
                          {isProviderFormOpen && currentProvider?.id === provider.id ? (
                            <ProviderForm
                              key={currentProvider.id}
                              provider={currentProvider}
                              pending={providerMutation.isPending}
                              onSave={(draft) => providerMutation.mutate({ draft, current: currentProvider })}
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {isProviderFormOpen &&
                  (!currentProvider || !providers.some((provider) => provider.id === currentProvider.id)) ? (
                    <div className="mt-4">
                      <ProviderForm
                        key="new-provider"
                        provider={null}
                        pending={providerMutation.isPending}
                        onSave={(draft) => providerMutation.mutate({ draft, current: null })}
                      />
                    </div>
                  ) : null}
                </section>
              ) : null}

              {isOwnMode ? (
                <section className="border-t border-border/60 pt-5">
                  <h2 className="font-heading text-xl font-semibold">{t(locale, 'settings.ai.models')}</h2>
                  <Field className="mt-4 max-w-sm">
                    <FieldLabel htmlFor="settings-model-provider">{t(locale, 'settings.ai.provider')}</FieldLabel>
                    <select
                      id="settings-model-provider"
                      className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
                      value={activeProviderId}
                      onChange={(event) => setSelectedProviderId(event.target.value)}
                    >
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="mt-4 flex flex-col gap-3">
                    {modelsByProvider.map((model) => (
                      <div key={model.id} className="flex flex-wrap items-center gap-3 border-b border-border/50 pb-3">
                        {editingModelId === model.id ? (
                          <ModelFields
                            draft={modelDraft}
                            setDraft={setModelDraft}
                            family={providers.find((p) => p.id === model.providerId)?.apiFamily ?? 'openai'}
                            locale={locale}
                          />
                        ) : (
                          <span className="min-w-32 font-medium">{model.label}</span>
                        )}
                        {editingModelId === model.id ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={modelMutation.isPending}
                            onClick={() => modelMutation.mutate({ draft: modelDraft, model })}
                          >
                            {t(locale, 'settings.save')}
                          </Button>
                        ) : (
                          <>
                            <span className="text-sm text-muted-foreground">{model.modelId}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingModelId(model.id);
                                setModelDraft({
                                  modelId: model.modelId,
                                  label: model.label,
                                  wireVariant: model.wireVariant,
                                });
                              }}
                            >
                              {t(locale, 'settings.edit')}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteMutation.mutate({ kind: 'model', id: model.id })}
                            >
                              {t(locale, 'settings.delete')}
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                    {!modelsByProvider.length ? (
                      <p className="text-sm text-muted-foreground">{t(locale, 'settings.ai.noModels')}</p>
                    ) : null}
                  </div>
                  {providers.length ? (
                    <form
                      className="mt-4 flex flex-col gap-3 border-t border-border/50 pt-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        modelMutation.mutate({ draft: modelDraft, model: null });
                      }}
                    >
                      <h3 className="font-medium">{t(locale, 'settings.ai.addModel')}</h3>
                      <ModelFields
                        draft={modelDraft}
                        setDraft={setModelDraft}
                        family={providers.find((p) => p.id === activeProviderId)?.apiFamily ?? 'openai'}
                        locale={locale}
                      />
                      <div>
                        <Button type="submit" variant="outline" disabled={modelMutation.isPending}>
                          {t(locale, 'settings.ai.addModel')}
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </section>
              ) : null}

              {isOwnMode ? (
                <section className="border-t border-border/60 pt-5">
                  <h2 className="font-heading text-xl font-semibold">{t(locale, 'settings.ai.capabilities')}</h2>
                  <div className="mt-3 flex flex-col">
                    {PURPOSES.map(({ key, labelKey }) => {
                      const setting = settings.find((item) => item.key === key);
                      const selected = purposeDraft[key] ?? setting?.modelId ?? '';
                      const saved = setting?.modelId ?? '';
                      const activeModels = models.filter((model) => {
                        const provider = providers.find((item) => item.id === model.providerId);
                        return (
                          model.isEnabled &&
                          provider?.isEnabled &&
                          LLM_WIRE_REGISTRY[provider.apiFamily].runtimeImplemented
                        );
                      });
                      return (
                        <Field
                          key={key}
                          className="grid gap-2 border-b border-border/50 py-4 sm:grid-cols-[minmax(10rem,1fr)_2fr] sm:items-center"
                        >
                          <FieldLabel htmlFor={`purpose-${key}`}>
                            {t(locale, `settings.ai.purpose.${labelKey}`)}
                          </FieldLabel>
                          <select
                            id={`purpose-${key}`}
                            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                            value={selected}
                            disabled={!activeModels.some((model) => model.id === selected) && Boolean(selected)}
                            onChange={(event) =>
                              setPurposeDraft((current) => ({ ...current, [key]: event.target.value }))
                            }
                          >
                            <option value="">{t(locale, 'settings.ai.notSet')}</option>
                            {activeModels.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.label}
                              </option>
                            ))}
                          </select>
                          <div className="sm:col-start-2">
                            <Button
                              type="button"
                              size="sm"
                              disabled={!selected || selected === saved || settingMutation.isPending}
                              onClick={() => settingMutation.mutate({ key, modelId: selected })}
                            >
                              {settingMutation.isPending ? t(locale, 'settings.saving') : t(locale, 'settings.save')}
                            </Button>
                          </div>
                          {setting?.modelId && !activeModels.some((model) => model.id === setting.modelId) ? (
                            <p className="text-sm text-muted-foreground sm:col-start-2">
                              {setting.modelLabel ?? t(locale, 'settings.ai.unavailableModel')}
                            </p>
                          ) : null}
                        </Field>
                      );
                    })}
                    <p className="mt-3 text-sm text-muted-foreground">{t(locale, 'settings.ai.defaultOnUnset')}</p>
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="tts" className="pt-6">
          {ttsQuery.isPending ? <p className="text-sm text-muted-foreground">{t(locale, 'settings.loading')}</p> : null}
          {ttsQuery.error ? (
            <p role="alert" className="text-sm text-destructive">
              {formatUserSettingsApiError(ttsQuery.error)}
            </p>
          ) : null}
          {ttsConfig ? <SettingsTtsSection key={String(ttsConfig.updatedAt)} config={ttsConfig} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ModelFields({
  draft,
  setDraft,
  family,
  locale,
}: {
  draft: ModelDraft;
  setDraft: Dispatch<SetStateAction<ModelDraft>>;
  family: LlmApiFamily;
  locale: 'en-US' | 'zh-CN';
}) {
  return (
    <div className="grid w-full gap-3 sm:grid-cols-3">
      <Field>
        <FieldLabel htmlFor="settings-model-label">{t(locale, 'settings.ai.modelName')}</FieldLabel>
        <Input
          id="settings-model-label"
          value={draft.label}
          onChange={(e) => setDraft((v) => ({ ...v, label: e.target.value }))}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="settings-model-id">{t(locale, 'settings.ai.modelId')}</FieldLabel>
        <Input
          id="settings-model-id"
          value={draft.modelId}
          onChange={(e) => setDraft((v) => ({ ...v, modelId: e.target.value }))}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="settings-wire-variant">{t(locale, 'settings.ai.connectionType')}</FieldLabel>
        <select
          id="settings-wire-variant"
          className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
          value={draft.wireVariant}
          onChange={(e) => setDraft((v) => ({ ...v, wireVariant: e.target.value }))}
        >
          {LLM_WIRE_REGISTRY[family].wireVariants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
