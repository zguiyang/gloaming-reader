'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@/i18n';
import { type AiSettingKey, LLM_WIRE_REGISTRY, type LlmModel, type LlmProvider } from '@/shared/llm';

import { type ModelDraft } from '@/features/settings/llm/model-form';
import { type ProviderDraft } from '@/features/settings/llm/provider-form';
import {
  createUserLlmModel,
  createUserLlmProvider,
  deleteUserLlmModel,
  deleteUserLlmProvider,
  formatUserSettingsApiError,
  listUserLlmModels,
  listUserLlmProviders,
  listUserLlmSettings,
  putUserLlmSetting,
  testUserLlmModel,
  updateUserLlmModel,
  updateUserLlmProvider,
  userSettingsQueryKey,
} from '@/features/settings/settings-api';
import { useLocale } from '@/lib/locale-context';

export type ModelTestResult = { status: 'success'; latencyMs: number } | { status: 'error'; message: string };

/** One inline editing context on the settings page at a time. */
export type EditingContext = 'tts' | 'ai-mode' | 'provider' | 'model' | 'model-add' | null;

/**
 * Own-AI settings controller: queries, derived data, editor state and mutations
 * for LLM providers, models and reading-purpose bindings.
 */
export function useOwnAiSettings({ enabled }: { enabled: boolean }) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const providersQuery = useQuery({
    queryKey: userSettingsQueryKey.providers(),
    queryFn: ({ signal }) => listUserLlmProviders(signal),
    enabled,
  });
  const settingsQuery = useQuery({
    queryKey: userSettingsQueryKey.settings(),
    queryFn: ({ signal }) => listUserLlmSettings(signal),
    enabled,
  });
  const providers = providersQuery.data ?? [];
  const [modelTestResults, setModelTestResults] = useState<Record<string, ModelTestResult>>({});
  const modelsQueries = useQueries({
    queries: providers.map((provider) => ({
      queryKey: [...userSettingsQueryKey.models(), provider.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => listUserLlmModels(provider.id, signal),
    })),
  });
  const models = useMemo(() => modelsQueries.flatMap((query) => query.data ?? []), [modelsQueries]);
  const [editingContext, setEditingContext] = useState<EditingContext>(null);
  const [editingProvider, setEditingProvider] = useState<LlmProvider | null>(null);
  const [shouldOpenKeyReplacement, setProviderStartReplacingKey] = useState(false);
  const [editingModelId, setEditingModelId] = useState('');
  // Provider that owns the currently-open "add model" form (models render inside their provider).
  const [addingModelProviderId, setAddingModelProviderId] = useState('');
  const [aiModeDraft, setAiModeDraft] = useState<'default' | 'own' | null>(null);
  const [purposeDraft, setPurposeDraft] = useState<Partial<Record<AiSettingKey, string>>>({});
  const isOwnMode = providers.some((provider) => provider.isEnabled);
  const settings = settingsQuery.data ?? [];
  const aiLoadError = providersQuery.error ?? settingsQuery.error;
  const isAiDataReady = !providersQuery.isPending && !settingsQuery.isPending && !aiLoadError;

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
    setAddingModelProviderId('');
  }

  // Latest local editor identity, so a slow save closing a stale editor can
  // never reset a newer draft the user has since opened (local guard only).
  const editingContextRef = useRef<EditingContext>(null);
  const editingProviderRef = useRef<LlmProvider | null>(null);
  const editingModelIdRef = useRef('');
  const addingModelProviderIdRef = useRef('');
  useEffect(() => {
    editingContextRef.current = editingContext;
    editingProviderRef.current = editingProvider;
    editingModelIdRef.current = editingModelId;
    addingModelProviderIdRef.current = addingModelProviderId;
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
    mutationFn: async ({
      draft,
      model,
      providerId,
    }: {
      draft: ModelDraft;
      model: LlmModel | null;
      providerId?: string;
    }) => {
      if (model)
        return updateUserLlmModel(model.id, {
          modelId: draft.modelId.trim(),
          label: draft.label.trim(),
          wireVariant: draft.wireVariant,
        });
      const provider = providers.find((item) => item.id === providerId);
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
    onSuccess: async (_updated, variables) => {
      const { model, providerId } = variables;
      await refreshLlm();
      if (model) {
        setModelTestResults((results) => {
          const next = { ...results };
          delete next[model.id];
          return next;
        });
      }
      // Only reset the editor if it still shows the saved model, or the same add
      // context for the same provider; a stale completion must not clobber a newer
      // draft opened for a different provider while this one was in flight.
      const isSameEditor = model
        ? editingContextRef.current === 'model' && editingModelIdRef.current === model.id
        : editingContextRef.current === 'model-add' && addingModelProviderIdRef.current === providerId;
      if (isSameEditor) {
        setEditingModelId('');
        setAddingModelProviderId('');
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

  const deleteMutation = useMutation({
    mutationFn: async ({ kind, id }: { kind: 'provider' | 'model'; id: string }) =>
      kind === 'provider' ? deleteUserLlmProvider(id) : deleteUserLlmModel(id),
    onSuccess: async () => {
      await refreshLlm();
      toast.success(t(locale, 'settings.saved'));
    },
    onError: (error) => toast.error(formatUserSettingsApiError(error)),
  });

  const activeModels = models.filter((model) => {
    const provider = providers.find((item) => item.id === model.providerId);
    return model.isEnabled && provider?.isEnabled && LLM_WIRE_REGISTRY[provider.apiFamily].runtimeImplemented;
  });

  return {
    locale,
    providersQuery,
    settingsQuery,
    providers,
    models,
    settings,
    activeModels,
    isOwnMode,
    aiLoadError,
    isAiDataReady,
    modelTestResults,
    editingContext,
    editingProvider,
    shouldOpenKeyReplacement,
    editingModelId,
    addingModelProviderId,
    aiModeDraft,
    setAiModeDraft,
    purposeDraft,
    setPurposeDraft,
    setEditingProvider,
    setProviderStartReplacingKey,
    setEditingModelId,
    setAddingModelProviderId,
    providerMutation,
    modelMutation,
    modelTestMutation,
    modeMutation,
    settingMutation,
    deleteMutation,
    openContext,
    closeContext,
  };
}

export type OwnAiSettings = ReturnType<typeof useOwnAiSettings>;
