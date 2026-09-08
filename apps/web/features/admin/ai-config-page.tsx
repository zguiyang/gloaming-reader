'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import type { AiSettingKey, LlmApiFamily, LlmModel, LlmProvider, ProviderBalanceResult } from '@gloaming/shared/llm';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs } from '@/components/ui/tabs';
import { AdminSegmentedTabsList, AdminSegmentedTabsTrigger } from '@/features/admin/admin-segmented-tabs';
import {
  adminLlmQueryKey,
  createLlmModel,
  createLlmProvider,
  deleteLlmModel,
  deleteLlmProvider,
  formatAdminLlmApiError,
  listLlmModels,
  listLlmProviders,
  listLlmSettings,
  putLlmSetting,
  queryLlmProviderBalance,
  testLlmProvider,
  updateLlmModel,
  updateLlmProvider,
} from '@/features/admin/ai-config-api';
import type { ModelFormValues } from '@/features/admin/ai-model-form';
import type { ProviderFormValues } from '@/features/admin/ai-provider-form';
import { AiProviderWorkspace, type ProviderTestResult } from '@/features/admin/ai-provider-workspace';
import { AiPurposePanel } from '@/features/admin/ai-purpose-panel';

type DeleteTarget = { kind: 'provider'; provider: LlmProvider } | { kind: 'model'; model: LlmModel } | null;

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function AiConfigPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'purposes' | 'providers'>('purposes');

  const providersQuery = useQuery({
    queryKey: adminLlmQueryKey.providers(),
    queryFn: ({ signal }) => listLlmProviders({ signal }),
  });
  const modelsQuery = useQuery({
    queryKey: adminLlmQueryKey.models(),
    queryFn: ({ signal }) => listLlmModels(undefined, { signal }),
  });
  const settingsQuery = useQuery({
    queryKey: adminLlmQueryKey.settings(),
    queryFn: ({ signal }) => listLlmSettings({ signal }),
  });

  const providers = providersQuery.data ?? [];
  const models = modelsQuery.data ?? [];
  const settings = settingsQuery.data ?? [];

  const isPending = providersQuery.isPending || modelsQuery.isPending || settingsQuery.isPending;
  const loadError = providersQuery.error ?? modelsQuery.error ?? settingsQuery.error;

  const [purposeDraft, setPurposeDraft] = useState<Partial<Record<AiSettingKey, string>>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [togglingProviderId, setTogglingProviderId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [balanceByProvider, setBalanceByProvider] = useState<Record<string, ProviderBalanceResult>>({});
  const [queryingBalanceId, setQueryingBalanceId] = useState<string | null>(null);

  async function invalidateLlmQueries() {
    await queryClient.invalidateQueries({ queryKey: adminLlmQueryKey.all });
  }

  const createProviderMutation = useMutation({
    mutationFn: async ({ apiFamily, values }: { apiFamily: LlmApiFamily; values: ProviderFormValues }) =>
      createLlmProvider({
        apiFamily,
        name: values.name.trim(),
        baseUrl: values.baseUrl.trim(),
        apiKey: values.apiKey.trim(),
        proxyUrl: values.proxyUrl.trim() || null,
        thinkingParam: values.thinkingParam.trim() || null,
        balanceEndpoint: values.balanceEndpoint.trim() || null,
        balanceAmountPath: values.balanceAmountPath.trim() || null,
        balanceCurrencyPath: values.balanceCurrencyPath.trim() || null,
        isEnabled: true,
      }),
    onSuccess: async () => {
      await invalidateLlmQueries();
      toast.success('已添加服务商');
    },
    onError: (error) => {
      toast.error(formatAdminLlmApiError(error));
    },
  });

  const updateProviderMutation = useMutation({
    mutationFn: async ({ provider, values }: { provider: LlmProvider; values: ProviderFormValues }) => {
      const apiKey = values.apiKey.trim();
      return updateLlmProvider(provider.id, {
        name: values.name.trim(),
        baseUrl: values.baseUrl.trim(),
        proxyUrl: values.proxyUrl.trim() || null,
        thinkingParam: values.thinkingParam.trim() || null,
        balanceEndpoint: values.balanceEndpoint.trim() || null,
        balanceAmountPath: values.balanceAmountPath.trim() || null,
        balanceCurrencyPath: values.balanceCurrencyPath.trim() || null,
        ...(apiKey ? { apiKey } : {}),
      });
    },
    onSuccess: async () => {
      await invalidateLlmQueries();
      toast.success('已保存服务商');
    },
    onError: (error) => {
      toast.error(formatAdminLlmApiError(error));
    },
  });

  const toggleProviderMutation = useMutation({
    mutationFn: async ({ provider, isEnabled }: { provider: LlmProvider; isEnabled: boolean }) => {
      setTogglingProviderId(provider.id);
      return updateLlmProvider(provider.id, { isEnabled });
    },
    onSuccess: async () => {
      await invalidateLlmQueries();
    },
    onError: (error) => {
      toast.error(formatAdminLlmApiError(error));
    },
    onSettled: () => {
      setTogglingProviderId(null);
    },
  });

  const createModelMutation = useMutation({
    mutationFn: async ({ provider, values }: { provider: LlmProvider; values: ModelFormValues }) => {
      const temperature = parseOptionalNumber(values.temperature);
      const maxTokensRaw = parseOptionalNumber(values.maxTokens);
      const maxTokens = maxTokensRaw != null ? Math.trunc(maxTokensRaw) : null;
      const contextLength = parseOptionalNumber(values.contextLength);
      const sortOrder = Math.trunc(parseOptionalNumber(values.sortOrder) ?? 0);
      return createLlmModel({
        providerId: provider.id,
        modelId: values.modelId.trim(),
        label: values.label.trim(),
        wireVariant: values.wireVariant,
        temperature,
        maxTokens,
        contextLength,
        isEnabled: values.isEnabled,
        sortOrder,
      });
    },
    onSuccess: async () => {
      await invalidateLlmQueries();
      toast.success('已添加模型');
    },
    onError: (error) => {
      toast.error(formatAdminLlmApiError(error));
    },
  });

  const updateModelMutation = useMutation({
    mutationFn: async ({ model, values }: { model: LlmModel; values: ModelFormValues }) => {
      const temperature = parseOptionalNumber(values.temperature);
      const maxTokensRaw = parseOptionalNumber(values.maxTokens);
      const maxTokens = maxTokensRaw != null ? Math.trunc(maxTokensRaw) : null;
      const contextLength = parseOptionalNumber(values.contextLength);
      const sortOrder = Math.trunc(parseOptionalNumber(values.sortOrder) ?? 0);
      return updateLlmModel(model.id, {
        modelId: values.modelId.trim(),
        label: values.label.trim(),
        wireVariant: values.wireVariant,
        temperature,
        maxTokens,
        contextLength,
        isEnabled: values.isEnabled,
        sortOrder,
      });
    },
    onSuccess: async () => {
      await invalidateLlmQueries();
      toast.success('已保存模型');
    },
    onError: (error) => {
      toast.error(formatAdminLlmApiError(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (target: NonNullable<DeleteTarget>) => {
      if (target.kind === 'provider') {
        await deleteLlmProvider(target.provider.id);
        return;
      }
      await deleteLlmModel(target.model.id);
    },
    onSuccess: async (_data, target) => {
      await invalidateLlmQueries();
      setDeleteTarget(null);
      toast.success(target.kind === 'provider' ? '已删除服务商' : '已删除模型');
    },
    onError: (error) => {
      toast.error(formatAdminLlmApiError(error));
      setDeleteTarget(null);
    },
  });

  const purposeMutation = useMutation({
    mutationFn: async (key: AiSettingKey) => {
      const modelId = purposeDraft[key];
      if (!modelId) {
        throw new Error('请先选择模型');
      }
      return putLlmSetting(key, { modelId });
    },
    onSuccess: async (_setting, key) => {
      await invalidateLlmQueries();
      setPurposeDraft((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      toast.success('已保存用途默认模型');
    },
    onError: (error) => {
      toast.error(formatAdminLlmApiError(error));
    },
  });

  const testMutation = useMutation({
    mutationFn: async (provider: LlmProvider) => {
      setTestingProviderId(provider.id);
      setTestResult(null);
      return testLlmProvider(provider.id);
    },
    onSuccess: (result, provider) => {
      setTestResult({
        providerId: provider.id,
        ok: true,
        message: `连通成功 · ${result.modelLabel} · ${result.latencyMs} ms`,
      });
      toast.message('连通测试完成');
    },
    onError: (error, provider) => {
      setTestResult({
        providerId: provider.id,
        ok: false,
        message: formatAdminLlmApiError(error),
      });
      toast.error(formatAdminLlmApiError(error));
    },
    onSettled: () => {
      setTestingProviderId(null);
    },
  });

  const balanceMutation = useMutation({
    mutationFn: async (provider: LlmProvider) => {
      setQueryingBalanceId(provider.id);
      return queryLlmProviderBalance(provider.id);
    },
    onSuccess: (result, provider) => {
      setBalanceByProvider((prev) => ({ ...prev, [provider.id]: result }));
      if (result.supported) {
        toast.message('余额已更新');
      }
    },
    onError: (error, provider) => {
      setBalanceByProvider((prev) => ({
        ...prev,
        [provider.id]: {
          supported: false,
          reason: 'request-failed',
          message: formatAdminLlmApiError(error),
        },
      }));
    },
    onSettled: () => {
      setQueryingBalanceId(null);
    },
  });

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto max-w-6xl">
      <div className="min-w-0">
        <h1 className="font-heading text-3xl font-bold tracking-tight">AI 配置</h1>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'purposes' | 'providers')}
        className="mt-8"
      >
        <AdminSegmentedTabsList>
          <AdminSegmentedTabsTrigger value="purposes">用途绑定</AdminSegmentedTabsTrigger>
          <AdminSegmentedTabsTrigger value="providers">服务商与模型</AdminSegmentedTabsTrigger>
        </AdminSegmentedTabsList>

        <div className="mt-8">
          {isPending ? (
            <>
              <Skeleton className="h-40 w-full rounded-2xl bg-muted/70" />
              <Skeleton className="mt-6 h-72 w-full rounded-2xl bg-muted/70" />
            </>
          ) : loadError ? (
            <p className="rounded-2xl border border-border bg-secondary/60 px-5 py-8 text-sm text-destructive md:px-6">
              {formatAdminLlmApiError(loadError)}
            </p>
          ) : activeTab === 'purposes' ? (
            <AiPurposePanel
              settings={settings}
              providers={providers}
              models={models}
              draftByKey={purposeDraft}
              onDraftChange={(key, modelId) =>
                setPurposeDraft((prev) => ({
                  ...prev,
                  [key]: modelId,
                }))
              }
              onSave={(key) => purposeMutation.mutate(key)}
            />
          ) : (
            <AiProviderWorkspace
              providers={providers}
              models={models}
              onCreateProvider={async (apiFamily, values) => createProviderMutation.mutateAsync({ apiFamily, values })}
              onUpdateProvider={async (provider, values) => {
                await updateProviderMutation.mutateAsync({ provider, values });
              }}
              onToggleProviderEnabled={async (provider, isEnabled) => {
                await toggleProviderMutation.mutateAsync({ provider, isEnabled });
              }}
              onDeleteProvider={(provider) => setDeleteTarget({ kind: 'provider', provider })}
              onCreateModel={async (provider, values) => {
                await createModelMutation.mutateAsync({ provider, values });
              }}
              onUpdateModel={async (model, values) => {
                await updateModelMutation.mutateAsync({ model, values });
              }}
              onDeleteModel={(model) => setDeleteTarget({ kind: 'model', model })}
              onTestProvider={(provider) => testMutation.mutate(provider)}
              onQueryBalance={(provider) => balanceMutation.mutate(provider)}
              testingProviderId={testingProviderId}
              togglingProviderId={togglingProviderId}
              testResult={testResult}
              balanceByProvider={balanceByProvider}
              queryingBalanceId={queryingBalanceId}
              isProviderSaving={createProviderMutation.isPending || updateProviderMutation.isPending}
              isModelSaving={createModelMutation.isPending || updateModelMutation.isPending}
            />
          )}
        </div>
      </Tabs>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTarget?.kind === 'provider' ? '删除服务商？' : '删除模型？'}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === 'provider'
                ? `将同时移除「${deleteTarget.provider.name}」下的全部模型。若仍被用途引用则无法删除。`
                : deleteTarget?.kind === 'model'
                  ? `将移除模型「${deleteTarget.model.label}」。若仍被用途引用则无法删除。`
                  : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget);
                }
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
