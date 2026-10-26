'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
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
import { nativeSelectFilledClasses } from '@/components/ui/control-appearance';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SecretField } from '@/components/ui/secret-field';
import { useAuthDialog } from '@/features/auth';
import {
  createUserLlmModel,
  createUserLlmProvider,
  deleteUserLlmModel,
  deleteUserLlmProvider,
  formatUserSettingsApiError,
  getPersonalTaggingPreference,
  getUserTtsConfig,
  listUserLlmModels,
  listUserLlmProviders,
  listUserLlmSettings,
  personalTaggingRunErrorKey,
  putPersonalTaggingPreference,
  putUserLlmSetting,
  testUserLlmModel,
  updateUserLlmModel,
  updateUserLlmProvider,
  userSettingsQueryKey,
} from '@/features/settings/settings-api';
import { SettingsTtsSection } from '@/features/settings/tts/settings-tts-section';
import { authClient } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type ProviderDraft = {
  apiFamily: LlmApiFamily;
  name: string;
  baseUrl: string;
  apiKey: string;
  proxyUrl: string;
  thinkingParam: string;
};
type ModelDraft = { modelId: string; label: string; wireVariant: string };
type ModelTestResult = { status: 'success'; latencyMs: number } | { status: 'error'; message: string };

/** One inline editing context on the settings page at a time. */
type EditingContext = 'tts' | 'ai-mode' | 'provider' | 'model' | 'model-add' | null;

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

function SummaryRow({
  label,
  value,
  description,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  description?: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const { locale } = useLocale();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/50 py-4">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-sm text-foreground">{t(locale, 'settings.current', { source: value })}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <Button type="button" variant="outline" size="sm" className="h-9 rounded-lg px-4" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}

function ProviderForm({
  provider,
  onSave,
  onCancel,
  pending,
  startReplacingKey = false,
}: {
  provider: LlmProvider | null;
  onSave: (draft: ProviderDraft) => void;
  onCancel: () => void;
  pending: boolean;
  /** Open the replacement input immediately (e.g. from a "replace key" summary action). */
  startReplacingKey?: boolean;
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
  const [isReplacingKey, setIsReplacingKey] = useState(startReplacingKey && Boolean(provider?.apiKeySet));

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
              className={cn(
                'h-11 w-full px-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                nativeSelectFilledClasses,
              )}
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
              appearance="filled"
              className="h-11"
              aria-invalid={Boolean(errors.name) || undefined}
              aria-describedby={errors.name ? 'settings-provider-name-error' : undefined}
              value={draft.name}
              onChange={(e) => setDraft((v) => ({ ...v, name: e.target.value }))}
            />
            <FieldError id="settings-provider-name-error">{errors.name}</FieldError>
          </Field>
          <Field data-invalid={Boolean(errors.baseUrl) || undefined}>
            <FieldLabel htmlFor="settings-provider-url">{t(locale, 'settings.ai.baseUrl')}</FieldLabel>
            <Input
              id="settings-provider-url"
              type="url"
              appearance="filled"
              className="h-11"
              aria-invalid={Boolean(errors.baseUrl) || undefined}
              aria-describedby={errors.baseUrl ? 'settings-provider-url-error' : undefined}
              placeholder={family.provider.baseUrlPlaceholder}
              value={draft.baseUrl}
              onChange={(e) => setDraft((v) => ({ ...v, baseUrl: e.target.value }))}
            />
            <FieldError id="settings-provider-url-error">{errors.baseUrl}</FieldError>
          </Field>
        </div>
        <SecretField
          id="settings-provider-key"
          label={t(locale, 'settings.ai.apiKey')}
          isSet={Boolean(provider?.apiKeySet)}
          masked={provider?.apiKeyMasked}
          value={draft.apiKey}
          onChange={(value) => setDraft((v) => ({ ...v, apiKey: value }))}
          replacing={isReplacingKey}
          onReplace={() => setIsReplacingKey(true)}
          onCancelReplace={() => {
            setDraft((v) => ({ ...v, apiKey: '' }));
            setIsReplacingKey(false);
          }}
          error={errors.apiKey}
          disabled={pending}
          placeholderWhenSet={t(locale, 'settings.secret.leaveBlank')}
          copy={{
            replaceLabel: t(locale, 'common.secret.newKey'),
            replaceAction: t(locale, 'common.secret.replace'),
            cancelReplaceAction: t(locale, 'common.secret.cancelReplace'),
            keepHint: t(locale, 'common.secret.keepHint'),
            configuredLabel: t(locale, 'common.secret.configured'),
          }}
        />
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
                appearance="filled"
                className="h-11"
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
                  appearance="filled"
                  className="h-11"
                  value={draft.thinkingParam}
                  onChange={(e) => setDraft((v) => ({ ...v, thinkingParam: e.target.value }))}
                />
              </Field>
            ) : null}
          </div>
        </details>
      </FieldGroup>
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-[8px] px-6"
          disabled={pending}
          onClick={onCancel}
        >
          {t(locale, 'settings.cancel')}
        </Button>
        <Button type="submit" className="h-11 rounded-[8px] px-6" disabled={pending}>
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
  const personalTaggingQuery = useQuery({
    queryKey: userSettingsQueryKey.personalTagging(),
    queryFn: ({ signal }) => getPersonalTaggingPreference(signal),
    enabled: Boolean(session.data?.user),
  });
  const providers = providersQuery.data ?? [];
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [modelTestResults, setModelTestResults] = useState<Record<string, ModelTestResult>>({});
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
  const [editingContext, setEditingContext] = useState<EditingContext>(null);
  // Default summary view vs focused own-AI advanced view (accepted board).
  const [view, setView] = useState<'summary' | 'advanced'>('summary');
  const [editingProvider, setEditingProvider] = useState<LlmProvider | null>(null);
  const [shouldOpenKeyReplacement, setProviderStartReplacingKey] = useState(false);
  const [modelDraft, setModelDraft] = useState<ModelDraft>(EMPTY_MODEL);
  const [editingModelId, setEditingModelId] = useState('');
  const [aiModeDraft, setAiModeDraft] = useState<'default' | 'own' | null>(null);
  const [purposeDraft, setPurposeDraft] = useState<Partial<Record<AiSettingKey, string>>>({});
  const isOwnMode = providers.some((provider) => provider.isEnabled);
  const settings = settingsQuery.data ?? [];
  // Independent domains: an AI query failure must not hide TTS, and vice versa.
  const aiLoadError = providersQuery.error ?? settingsQuery.error;
  const ttsLoadError = ttsQuery.error;
  const isAiDataReady = !providersQuery.isPending && !settingsQuery.isPending && !aiLoadError;

  useEffect(() => {
    if (!session.isPending && session.error?.status === 401) openLogin();
  }, [openLogin, session.error?.status, session.isPending]);

  async function refreshLlm() {
    await queryClient.invalidateQueries({ queryKey: [...userSettingsQueryKey.all, 'llm'] });
  }

  function openContext(context: Exclude<EditingContext, null>) {
    setEditingContext(context);
  }

  function closeContext() {
    setEditingContext(null);
    setAiModeDraft(null);
    setEditingProvider(null);
    setProviderStartReplacingKey(false);
    setEditingModelId('');
    setModelDraft(EMPTY_MODEL);
  }

  // Latest local editor identity, so a slow save closing a stale editor can
  // never reset a newer draft the user has since opened (local guard only).
  const editingContextRef = useRef<EditingContext>(null);
  const editingProviderRef = useRef<LlmProvider | null>(null);
  const editingModelIdRef = useRef('');
  useEffect(() => {
    editingContextRef.current = editingContext;
    editingProviderRef.current = editingProvider;
    editingModelIdRef.current = editingModelId;
  });

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
    onSuccess: async (_data, { current }) => {
      await refreshLlm();
      setModelTestResults({});
      // Only close the editor if it is still the one this save belongs to.
      if (
        editingContextRef.current === 'provider' &&
        (editingProviderRef.current?.id ?? null) === (current?.id ?? null)
      ) {
        closeContext();
      }
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
    onSuccess: async (_updated, { model }) => {
      await refreshLlm();
      if (model) {
        setModelTestResults((results) => {
          const next = { ...results };
          delete next[model.id];
          return next;
        });
      }
      // Only reset the editor if it still shows the saved model (or the same
      // add context); a stale completion must not clobber a newer draft.
      const isSameEditor = model
        ? editingContextRef.current === 'model' && editingModelIdRef.current === model.id
        : editingContextRef.current === 'model-add';
      if (isSameEditor) {
        setModelDraft(EMPTY_MODEL);
        setEditingModelId('');
        setEditingContext(null);
      }
      toast.success(t(locale, 'settings.saved'));
    },
    onError: (error) => toast.error(formatUserSettingsApiError(error)),
  });

  const modelTestMutation = useMutation({
    mutationFn: (modelId: string) => testUserLlmModel(modelId),
    onMutate: (modelId) => {
      setModelTestResults((results) => {
        const next = { ...results };
        delete next[modelId];
        return next;
      });
    },
    onSuccess: (result, modelId) => {
      setModelTestResults((results) => ({ ...results, [modelId]: { status: 'success', latencyMs: result.latencyMs } }));
    },
    onError: (error, modelId) => {
      setModelTestResults((results) => ({
        ...results,
        [modelId]: { status: 'error', message: formatUserSettingsApiError(error) },
      }));
    },
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
      // Only close the mode editor if it is still the open context.
      if (editingContextRef.current === 'ai-mode') {
        setAiModeDraft(null);
        setEditingContext(null);
      }
      toast.success(t(locale, 'settings.saved'));
    },
    onError: (error) => toast.error(formatUserSettingsApiError(error)),
  });

  const settingMutation = useMutation({
    mutationFn: ({ key, modelId }: { key: AiSettingKey; modelId: string }) => putUserLlmSetting(key, { modelId }),
    onSuccess: async (_setting, { key }) => {
      await queryClient.invalidateQueries({ queryKey: userSettingsQueryKey.settings() });
      setPurposeDraft((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      toast.success(t(locale, 'settings.saved'));
    },
    onError: (error) => toast.error(formatUserSettingsApiError(error)),
  });

  const personalTaggingMutation = useMutation({
    mutationFn: (enabled: boolean) => putPersonalTaggingPreference(enabled),
    onSuccess: async (preference) => {
      queryClient.setQueryData(userSettingsQueryKey.personalTagging(), preference);
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
  const ttsSourceLabel =
    ttsConfig?.configured && ttsConfig.isEnabled ? t(locale, 'settings.ownApi') : t(locale, 'settings.defaultService');
  const aiSourceLabel = isOwnMode ? t(locale, 'settings.ownApi') : t(locale, 'settings.defaultService');
  const activeModels = models.filter((model) => {
    const provider = providers.find((item) => item.id === model.providerId);
    return model.isEnabled && provider?.isEnabled && LLM_WIRE_REGISTRY[provider.apiFamily].runtimeImplemented;
  });

  // Focused advanced view replaces the default body (accepted board), same route.
  if (view === 'advanced') {
    return (
      <div className="mx-auto w-full max-w-3xl pb-8">
        <header className="mb-6 border-b border-border/40 pb-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 mb-3"
            onClick={() => {
              closeContext();
              setView('summary');
            }}
          >
            {t(locale, 'settings.ownAi.back')}
          </Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
            {t(locale, 'settings.ownAi.title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t(locale, 'settings.ownAi.description')}</p>
        </header>

        {(providersQuery.isPending || settingsQuery.isPending) && (
          <p className="mb-6 text-sm text-muted-foreground">{t(locale, 'settings.loading')}</p>
        )}
        {aiLoadError && (
          <p role="alert" className="mb-6 text-sm text-destructive">
            {formatUserSettingsApiError(aiLoadError)}
          </p>
        )}

        {isAiDataReady ? (
          <div className="flex flex-col gap-8">
            {/* Providers: summary rows + explicit edit; one editing context at a time */}
            <section>
              <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-2">
                <h2 className="text-base font-semibold text-foreground">{t(locale, 'settings.ai.providers')}</h2>
                {editingContext !== 'provider' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-lg px-4"
                    onClick={() => {
                      setEditingProvider(null);
                      setProviderStartReplacingKey(false);
                      openContext('provider');
                    }}
                  >
                    {t(locale, 'settings.ai.addProviderEntry')}
                  </Button>
                ) : null}
              </div>

              {providers.map((provider) => (
                <div key={provider.id} className="border-b border-border/50 py-3">
                  {editingContext === 'provider' && currentProvider?.id === provider.id ? (
                    <div className="mt-1">
                      <ProviderForm
                        key={currentProvider.id}
                        provider={currentProvider}
                        pending={providerMutation.isPending}
                        startReplacingKey={shouldOpenKeyReplacement}
                        onSave={(draft) => providerMutation.mutate({ draft, current: currentProvider })}
                        onCancel={closeContext}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="min-w-32 font-medium">{provider.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {LLM_WIRE_REGISTRY[provider.apiFamily].label}
                      </span>
                      {!LLM_WIRE_REGISTRY[provider.apiFamily].runtimeImplemented ? (
                        <span className="text-sm text-muted-foreground">
                          {t(locale, 'settings.ai.notAvailableYet')}
                        </span>
                      ) : null}
                      {provider.apiKeySet ? (
                        <span className="text-sm text-foreground">
                          {t(locale, 'common.secret.configured')} · {provider.apiKeyMasked ?? '••••'}
                        </span>
                      ) : null}
                      {provider.apiKeySet ? (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="px-0"
                          onClick={() => {
                            setEditingProvider(provider);
                            setProviderStartReplacingKey(true);
                            openContext('provider');
                          }}
                        >
                          {t(locale, 'settings.ai.replaceKey')}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingProvider(provider);
                          setProviderStartReplacingKey(false);
                          openContext('provider');
                        }}
                      >
                        {t(locale, 'settings.edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate({ kind: 'provider', id: provider.id })}
                      >
                        {t(locale, 'settings.delete')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {!providers.length ? (
                <p className="py-3 text-sm text-muted-foreground">{t(locale, 'settings.ai.noProviders')}</p>
              ) : null}
              {editingContext === 'provider' && !currentProvider ? (
                <div className="mt-3">
                  <ProviderForm
                    key="new-provider"
                    provider={null}
                    pending={providerMutation.isPending}
                    onSave={(draft) => providerMutation.mutate({ draft, current: null })}
                    onCancel={closeContext}
                  />
                </div>
              ) : null}
            </section>

            {/* Models: single editor well (680px) + summary rows + collapsed add entry */}
            <section>
              <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-2">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-base font-semibold text-foreground">{t(locale, 'settings.ai.models')}</h2>
                  <span className="text-xs text-muted-foreground">{t(locale, 'settings.ai.testCostNotice')}</span>
                </div>
                {editingContext !== 'model-add' && editingContext !== 'model' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-lg px-4"
                    onClick={() => {
                      setModelDraft(EMPTY_MODEL);
                      openContext('model-add');
                    }}
                  >
                    {t(locale, 'settings.ai.addModelEntry')}
                  </Button>
                ) : null}
              </div>

              {providers.length ? (
                <Field className="my-3 max-w-sm">
                  <FieldLabel htmlFor="settings-model-provider">{t(locale, 'settings.ai.provider')}</FieldLabel>
                  <select
                    id="settings-model-provider"
                    className={cn(
                      'h-11 w-full px-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                      nativeSelectFilledClasses,
                    )}
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
              ) : null}

              <div className="flex flex-col">
                {modelsByProvider.map((model) => {
                  const modelProvider = providers.find((provider) => provider.id === model.providerId);
                  const isRuntimeImplemented = modelProvider
                    ? LLM_WIRE_REGISTRY[modelProvider.apiFamily].runtimeImplemented
                    : false;
                  const testResult = modelTestResults[model.id];
                  const isTesting = modelTestMutation.isPending && modelTestMutation.variables === model.id;
                  const isEditingThis = editingContext === 'model' && editingModelId === model.id;
                  return (
                    <div key={model.id} className="border-b border-border/50 py-3">
                      {isEditingThis ? (
                        <div className="flex max-w-[680px] flex-col gap-4 rounded-2xl border border-border bg-card p-5">
                          <p className="text-sm font-semibold text-foreground">
                            {t(locale, 'settings.ai.saveModel')} · {model.label}
                          </p>
                          <ModelFields
                            draft={modelDraft}
                            setDraft={setModelDraft}
                            family={modelProvider?.apiFamily ?? 'openai'}
                            locale={locale}
                          />
                          <div className="flex justify-end gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              className="h-11 rounded-[8px] px-6"
                              disabled={modelMutation.isPending}
                              onClick={closeContext}
                            >
                              {t(locale, 'settings.ai.cancelChanges')}
                            </Button>
                            <Button
                              type="button"
                              className="h-11 rounded-[8px] px-6"
                              disabled={modelMutation.isPending}
                              onClick={() => modelMutation.mutate({ draft: modelDraft, model })}
                            >
                              {modelMutation.isPending
                                ? t(locale, 'settings.saving')
                                : t(locale, 'settings.ai.saveModel')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="min-w-32 font-medium">{model.label}</span>
                          <span className="font-mono text-sm text-muted-foreground">{model.modelId}</span>
                          {!model.isEnabled ? (
                            <span className="text-sm text-muted-foreground">{t(locale, 'settings.ai.disabled')}</span>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={
                              modelTestMutation.isPending ||
                              !model.isEnabled ||
                              !modelProvider?.isEnabled ||
                              !isRuntimeImplemented
                            }
                            onClick={() => modelTestMutation.mutate(model.id)}
                          >
                            {isTesting
                              ? t(locale, 'settings.ai.testingConnection')
                              : t(locale, 'settings.ai.testConnection')}
                          </Button>
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
                              openContext('model');
                            }}
                          >
                            {t(locale, 'settings.edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteMutation.mutate({ kind: 'model', id: model.id })}
                          >
                            {t(locale, 'settings.delete')}
                          </Button>
                        </div>
                      )}
                      {testResult?.status === 'success' ? (
                        <p role="status" className="mt-2 text-sm text-muted-foreground">
                          {t(locale, 'settings.ai.testSucceeded', { latencyMs: String(testResult.latencyMs) })}
                        </p>
                      ) : null}
                      {testResult?.status === 'error' ? (
                        <p role="alert" className="mt-2 text-sm text-destructive">
                          {t(locale, 'settings.ai.testFailed', { message: testResult.message })}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                {!modelsByProvider.length ? (
                  <p className="py-3 text-sm text-muted-foreground">{t(locale, 'settings.ai.noModels')}</p>
                ) : null}
              </div>

              {editingContext === 'model-add' && providers.length ? (
                <form
                  className="mt-3 flex max-w-[680px] flex-col gap-4 rounded-2xl border border-border bg-card p-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    modelMutation.mutate({ draft: modelDraft, model: null });
                  }}
                >
                  <ModelFields
                    draft={modelDraft}
                    setDraft={setModelDraft}
                    family={providers.find((p) => p.id === activeProviderId)?.apiFamily ?? 'openai'}
                    locale={locale}
                  />
                  <div className="flex justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 rounded-[8px] px-6"
                      disabled={modelMutation.isPending}
                      onClick={closeContext}
                    >
                      {t(locale, 'settings.ai.cancelChanges')}
                    </Button>
                    <Button type="submit" className="h-11 rounded-[8px] px-6" disabled={modelMutation.isPending}>
                      {modelMutation.isPending ? t(locale, 'settings.saving') : t(locale, 'settings.ai.addModelEntry')}
                    </Button>
                  </div>
                </form>
              ) : null}
            </section>

            {/* Purposes: always-visible selector; Save/Cancel appear only while a row's draft differs from the saved binding */}
            <section>
              <div className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2">
                <h2 className="text-base font-semibold text-foreground">{t(locale, 'settings.ai.capabilities')}</h2>
                <span className="text-xs text-muted-foreground">{t(locale, 'settings.ai.defaultOnUnset')}</span>
              </div>
              <div className="flex flex-col">
                {PURPOSES.map(({ key, labelKey }) => {
                  const setting = settings.find((item) => item.key === key);
                  const saved = setting?.modelId ?? '';
                  const selected = purposeDraft[key] ?? saved;
                  const savedModel = models.find((model) => model.id === saved);
                  const isDirty = selected !== saved;
                  // Saved binding may reference a model that is no longer active;
                  // keep it visible in the selector instead of disabling the row.
                  const isSavedUnavailable = Boolean(saved) && !activeModels.some((model) => model.id === saved);
                  const isSelectorDisabled = activeModels.length === 0 || settingMutation.isPending;
                  return (
                    <div key={key} className="flex flex-col gap-3 border-b border-border/50 py-4">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="text-sm font-semibold text-foreground">
                          {t(locale, `settings.ai.purpose.${labelKey}`)}
                        </p>
                        {isSavedUnavailable ? (
                          <p className="text-sm text-muted-foreground">{t(locale, 'settings.ai.unavailableModel')}</p>
                        ) : null}
                      </div>
                      {/* Stable layout: full-width selector with a fixed-height action row below on
                          narrow screens; inline reserved action slot on desktop. The slot keeps a
                          constant footprint (empty and noninteractive while clean), so dirty-state
                          actions never shift neighboring rows or the selector itself. */}
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                        <div className="min-w-0 w-full sm:w-auto sm:max-w-sm sm:flex-1">
                          <select
                            id={`purpose-${key}`}
                            aria-label={t(locale, `settings.ai.purpose.${labelKey}`)}
                            className={cn(
                              'h-11 w-full px-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                              nativeSelectFilledClasses,
                            )}
                            value={selected}
                            disabled={isSelectorDisabled}
                            onChange={(event) =>
                              setPurposeDraft((current) => ({ ...current, [key]: event.target.value }))
                            }
                          >
                            {isSavedUnavailable ? (
                              // Clearly identified and nonselectable as a replacement; it stays visible
                              // only to express the saved binding until the user picks an alternative.
                              <option value={saved} disabled>
                                {`${setting?.modelLabel ?? savedModel?.label ?? saved} ${t(locale, 'settings.ai.unavailableOption')}`}
                              </option>
                            ) : null}
                            <option value="">{t(locale, 'settings.ai.notSet')}</option>
                            {activeModels.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div
                          className="flex h-9 w-full items-center gap-2 sm:w-36"
                          aria-hidden={isDirty ? undefined : true}
                        >
                          {isDirty ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                className="h-9"
                                disabled={!selected || settingMutation.isPending}
                                onClick={() => settingMutation.mutate({ key, modelId: selected })}
                              >
                                {settingMutation.isPending ? t(locale, 'settings.saving') : t(locale, 'settings.save')}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={settingMutation.isPending}
                                onClick={() => {
                                  // Local cancel restores only this row's saved binding.
                                  setPurposeDraft((current) => {
                                    const next = { ...current };
                                    delete next[key];
                                    return next;
                                  });
                                }}
                              >
                                {t(locale, 'settings.cancel')}
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl pb-8">
      <SettingHeader />

      {(providersQuery.isPending || settingsQuery.isPending) && (
        <p className="mb-6 text-sm text-muted-foreground">{t(locale, 'settings.loading')}</p>
      )}
      {aiLoadError && (
        <p role="alert" className="mb-6 text-sm text-destructive">
          {formatUserSettingsApiError(aiLoadError)}
        </p>
      )}
      {ttsLoadError && (
        <p role="alert" className="mb-6 text-sm text-destructive">
          {formatUserSettingsApiError(ttsLoadError)}
        </p>
      )}

      {/* Reading services: read-only summaries + explicit Change; one editing context at a time */}
      <section className="mb-8">
        <h2 className="font-heading mb-2 text-xl font-semibold">{t(locale, 'settings.readingServices.title')}</h2>
        <SummaryRow
          label={t(locale, 'settings.tts.title')}
          value={ttsSourceLabel}
          description={
            ttsConfig?.configured && ttsConfig.isEnabled
              ? t(locale, 'settings.tts.ownSummary')
              : t(locale, 'settings.tts.defaultSummary')
          }
          actionLabel={t(locale, 'settings.change')}
          onAction={() => openContext('tts')}
        />
        {editingContext === 'tts' && ttsConfig ? (
          <div className="border-b border-border/50 py-4">
            <SettingsTtsSection key={String(ttsConfig.updatedAt)} config={ttsConfig} hideTitle />
            <div className="mt-3">
              <Button type="button" variant="ghost" size="sm" onClick={closeContext}>
                {t(locale, 'settings.cancel')}
              </Button>
            </div>
          </div>
        ) : null}

        <SummaryRow
          label={t(locale, 'settings.ai.service')}
          value={aiSourceLabel}
          description={isOwnMode ? t(locale, 'settings.ai.ownSummary') : t(locale, 'settings.ai.defaultSummary')}
          actionLabel={t(locale, 'settings.change')}
          onAction={() => openContext('ai-mode')}
        />
        {editingContext === 'ai-mode' ? (
          <div className="border-b border-border/50 py-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label={t(locale, 'settings.serviceMode')}>
              <Button
                type="button"
                variant={(aiModeDraft ?? (isOwnMode ? 'own' : 'default')) === 'default' ? 'default' : 'outline'}
                onClick={() => setAiModeDraft('default')}
              >
                {t(locale, 'settings.defaultService')}
              </Button>
              <Button
                type="button"
                variant={(aiModeDraft ?? (isOwnMode ? 'own' : 'default')) === 'own' ? 'default' : 'outline'}
                onClick={() => setAiModeDraft('own')}
              >
                {t(locale, 'settings.ownApi')}
              </Button>
            </div>
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
          </div>
        ) : null}
      </section>

      {/* EPUB organization: instantly saved preference toggle */}
      <section className="mb-8 border-b border-border/40 pb-6">
        <h2 className="font-heading mb-3 text-xl font-semibold">{t(locale, 'settings.personalTagging.title')}</h2>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label htmlFor="settings-personal-tagging" className="text-sm text-foreground">
            {t(locale, 'settings.personalTagging.toggle')}
          </label>
          <input
            id="settings-personal-tagging"
            type="checkbox"
            className="size-5 accent-primary"
            checked={personalTaggingQuery.data?.enabled ?? false}
            disabled={personalTaggingQuery.isPending || personalTaggingMutation.isPending}
            onChange={(event) => personalTaggingMutation.mutate(event.target.checked)}
          />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t(locale, 'settings.personalTagging.description')}</p>
        {personalTaggingQuery.data?.enabled && !personalTaggingQuery.data.providerAvailable ? (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            {t(locale, 'settings.personalTagging.providerUnavailable')}
          </p>
        ) : null}
        {personalTaggingQuery.data?.enabled &&
        personalTaggingQuery.data.providerAvailable &&
        personalTaggingQuery.data.latestRunState ? (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            {personalTaggingQuery.data.latestRunState === 'failed'
              ? t(locale, personalTaggingRunErrorKey(personalTaggingQuery.data.latestRunErrorCode))
              : t(locale, `settings.personalTagging.runState.${personalTaggingQuery.data.latestRunState}`)}
          </p>
        ) : null}
        {personalTaggingQuery.error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {formatUserSettingsApiError(personalTaggingQuery.error)}
          </p>
        ) : null}
      </section>

      {/* Own AI service: entry always reachable, opens the focused advanced view */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-heading text-xl font-semibold">{t(locale, 'settings.ownAi.title')}</h2>
            <p className="text-sm text-muted-foreground">{t(locale, 'settings.ownAi.description')}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-lg px-4"
            onClick={() => setView('advanced')}
          >
            {t(locale, 'settings.ownAi.enter')}
          </Button>
        </div>
      </section>
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
    <div className="flex w-full max-w-[680px] flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="settings-model-label">{t(locale, 'settings.ai.modelName')}</FieldLabel>
        <Input
          id="settings-model-label"
          appearance="filled"
          className="h-11"
          value={draft.label}
          onChange={(e) => setDraft((v) => ({ ...v, label: e.target.value }))}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="settings-model-id">{t(locale, 'settings.ai.modelId')}</FieldLabel>
        <Input
          id="settings-model-id"
          appearance="filled"
          className="h-11"
          value={draft.modelId}
          onChange={(e) => setDraft((v) => ({ ...v, modelId: e.target.value }))}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="settings-wire-variant">{t(locale, 'settings.ai.connectionType')}</FieldLabel>
        <select
          id="settings-wire-variant"
          className={cn(
            'h-11 w-full px-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            nativeSelectFilledClasses,
          )}
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
