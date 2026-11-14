'use client';

import { t } from '@/i18n';
import { type AiSettingKey, LLM_WIRE_REGISTRY } from '@/shared/llm';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EMPTY_MODEL, ModelForm } from '@/features/settings/llm/model-form';
import { ProviderForm } from '@/features/settings/llm/provider-form';
import { type OwnAiSettings } from '@/features/settings/llm/use-own-ai-settings';
import { formatUserSettingsApiError } from '@/features/settings/settings-api';
import { getApiFamilyLabel } from '@/lib/llm-protocol-labels';
import { cn } from '@/lib/utils';

const PURPOSES: Array<{ key: AiSettingKey; labelKey: string }> = [
  { key: 'assist.default_model_id', labelKey: 'assist' },
  { key: 'translate.default_model_id', labelKey: 'translate' },
];

/** Focused own-AI configuration view (providers, models and reading-purpose bindings). */
export function OwnAiView({ state, onBack }: { state: OwnAiSettings; onBack: () => void }) {
  const { locale } = state;
  const {
    providers,
    models,
    settings,
    activeModels,
    isOwnMode,
    providersQuery,
    settingsQuery,
    aiLoadError,
    isAiDataReady,
    editingContext,
    editingProvider: currentProvider,
    shouldOpenKeyReplacement,
    editingModelId,
    addingModelProviderId,
    purposeDraft,
    setPurposeDraft,
    setEditingProvider,
    setProviderStartReplacingKey,
    setEditingModelId,
    setAddingModelProviderId,
    modelTestResults,
    providerMutation,
    modelMutation,
    modelTestMutation,
    settingMutation,
    deleteMutation,
    openContext,
    closeContext,
  } = state;
  const enabledProviderCount = providers.filter((provider) => provider.isEnabled).length;

  return (
    <div className="mx-auto w-full max-w-3xl pb-8">
      <header className="mb-6 border-b border-border/40 pb-4">
        <Button type="button" variant="ghost" size="sm" className="-ml-2 mb-3" onClick={onBack}>
          {t(locale, 'settings.ownAi.back')}
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          {t(locale, 'settings.ownAi.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(locale, 'settings.ownAi.description')}</p>
        {/* Truthful derived aggregate of the mode (no independent mode field is edited here). */}
        <p className="mt-1.5 text-xs text-muted-foreground">
          {isOwnMode
            ? t(locale, 'settings.ai.modeOwn', { count: String(enabledProviderCount) })
            : t(locale, 'settings.ai.modeDefault')}
        </p>
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
          {/* Part A — reading purposes (lead task): always-visible selectors grouped by provider */}
          <section>
            <div className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2">
              <h2 className="text-base font-semibold text-foreground">{t(locale, 'settings.ai.capabilities')}</h2>
              <span className="text-xs text-muted-foreground">{t(locale, 'settings.ai.defaultOnUnset')}</span>
            </div>
            {/* Breathing room under the heading divider so it never touches the first row's
                selector; consistent at every viewport (rows stack below the label on narrow). */}
            <div className="mt-3 flex flex-col">
              {PURPOSES.map(({ key, labelKey }) => {
                const setting = settings.find((item) => item.key === key);
                const saved = setting?.modelId ?? '';
                const selected = purposeDraft[key] ?? saved;
                const savedModel = models.find((model) => model.id === saved);
                const savedProvider = savedModel
                  ? providers.find((provider) => provider.id === savedModel.providerId)
                  : undefined;
                const isDirty = selected !== saved;
                // Saved binding may reference a model that is no longer active; keep it
                // visible in the selector (explained + replaceable) instead of disabling the row.
                const isSavedUnavailable = Boolean(saved) && !activeModels.some((model) => model.id === saved);
                const isSelectorDisabled = activeModels.length === 0 || settingMutation.isPending;
                const selectedModel = activeModels.find((model) => model.id === selected);
                const selectedProvider =
                  selectedModel && providers.find((provider) => provider.id === selectedModel.providerId);
                const selectedLabel = selectedModel
                  ? `${selectedModel.label}${selectedModel.label !== selectedModel.modelId ? ` · ${selectedModel.modelId}` : ''}${selectedProvider ? ` · ${selectedProvider.name}` : ''}`
                  : selected && selected === saved && isSavedUnavailable
                    ? `${setting?.modelLabel ?? savedModel?.label ?? saved}${savedProvider ? ` · ${savedProvider.name}` : ''} ${t(locale, 'settings.ai.unavailableOption')}`
                    : t(locale, 'settings.ai.notSet');
                // Group options by provider so two same-label models stay distinguishable.
                const optionGroups = providers
                  .map((provider) => ({
                    provider,
                    models: activeModels.filter((model) => model.providerId === provider.id),
                  }))
                  .filter((group) => group.models.length > 0);
                // Real per-row save-failure flag from settingMutation: shown only while the exact failed
                // selection is still chosen and dirty, so it clears on cancel or a fresh pick. Copy is a
                // fixed string; the detailed API error stays in the toast (see the mutation onError).
                const hasSaveError =
                  settingMutation.isError &&
                  settingMutation.variables?.key === key &&
                  isDirty &&
                  selected === settingMutation.variables?.modelId;
                return (
                  <div
                    key={key}
                    className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-0 [grid-template-areas:'name_actions'_'select_select'_'note_note'] sm:grid-cols-[148px_minmax(0,1fr)] sm:gap-x-4 sm:[grid-template-areas:'name_select'_'._actions'_'note_note']"
                  >
                    {/* Purpose label */}
                    <div className="[grid-area:name] flex min-h-[44px] items-center sm:min-h-0">
                      <label htmlFor={`purpose-${key}`} className="text-sm font-semibold text-foreground">
                        {t(locale, `settings.ai.purpose.${labelKey}`)}
                      </label>
                    </div>
                    {/* Persistent selector fills the remaining width to the section right edge */}
                    <div className="[grid-area:select] min-w-0">
                      <Select
                        value={selected || null}
                        disabled={isSelectorDisabled}
                        onValueChange={(value) => setPurposeDraft((current) => ({ ...current, [key]: value ?? '' }))}
                      >
                        <SelectTrigger id={`purpose-${key}`} appearance="filled" className="h-11 w-full">
                          <SelectValue>{selectedLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {isSavedUnavailable ? (
                              // Kept visible only to express the saved binding; not a selectable replacement.
                              <SelectItem value={saved} disabled>
                                {`${setting?.modelLabel ?? savedModel?.label ?? saved}${savedProvider ? ` · ${savedProvider.name}` : ''} ${t(locale, 'settings.ai.unavailableOption')}`}
                              </SelectItem>
                            ) : null}
                            {/* A bound purpose cannot be cleared (PUT requires a non-empty modelId); the
                            empty placeholder is only selectable while the purpose is unbound. */}
                            <SelectItem value="" disabled={Boolean(saved)}>
                              {t(locale, 'settings.ai.notSet')}
                            </SelectItem>
                          </SelectGroup>
                          {optionGroups.map((group) => (
                            <SelectGroup key={group.provider.id}>
                              <SelectLabel>{group.provider.name}</SelectLabel>
                              {group.models.map((model) => (
                                <SelectItem key={model.id} value={model.id}>
                                  {model.label !== model.modelId
                                    ? `${model.label} · ${model.modelId} · ${group.provider.name}`
                                    : `${model.label} · ${group.provider.name}`}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Dirty-only Save/Cancel: below the control (right-aligned) on desktop; beside
                        the label on narrow. A reserved, non-interactive strip keeps clean/dirty/
                        pending/error/cancel from shifting the field, right edge, or neighbours. */}
                    <div
                      className="[grid-area:actions] flex min-h-[44px] items-center justify-end gap-2 sm:min-h-[36px]"
                      aria-hidden={isDirty ? undefined : true}
                    >
                      {isDirty ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            className="h-11 sm:h-9 dark:bg-[var(--brand-deep)] dark:hover:bg-[var(--brand-deep)]"
                            disabled={!selected || settingMutation.isPending}
                            onClick={() => settingMutation.mutate({ key, modelId: selected })}
                          >
                            {settingMutation.isPending ? t(locale, 'settings.saving') : t(locale, 'settings.save')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-11 sm:h-9"
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
                    {/* Reserved feedback slot: real save error (draft kept) or unavailable explanation. */}
                    <p
                      className={cn(
                        '[grid-area:note] min-h-[17px] text-xs leading-[17px]',
                        hasSaveError ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {hasSaveError
                        ? t(locale, 'settings.ai.purposeSaveFailed')
                        : isSavedUnavailable
                          ? t(locale, 'settings.ai.unavailableModel')
                          : ''}
                    </p>
                  </div>
                );
              })}
              {activeModels.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">{t(locale, 'settings.ai.noModels')}</p>
              ) : null}
            </div>
          </section>

          {/* Part B — connections & models: each provider is one grouped object with its models
              and add/edit forms rendered inside its own context. */}
          <section>
            <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-2">
              <h2 className="text-base font-semibold text-foreground">
                {t(locale, 'settings.ai.connectionsAndModels')}
              </h2>
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
            <p className="mt-2 text-xs text-muted-foreground">{t(locale, 'settings.ai.testCostNotice')}</p>

            {/* New-provider form renders at the top of the section (no target provider yet). */}
            {editingContext === 'provider' && !currentProvider ? (
              <div className="border-b border-border/50 py-4">
                <ProviderForm
                  key="new-provider"
                  provider={null}
                  pending={providerMutation.isPending}
                  onSave={(draft) => providerMutation.mutate({ draft, current: null })}
                  onCancel={closeContext}
                />
              </div>
            ) : null}

            {providers.map((provider) => {
              const providerModels = models.filter((model) => model.providerId === provider.id);
              const isEditingThisProvider = editingContext === 'provider' && currentProvider?.id === provider.id;
              const isAddingModelHere = editingContext === 'model-add' && addingModelProviderId === provider.id;
              const isRuntimeImplemented = LLM_WIRE_REGISTRY[provider.apiFamily].runtimeImplemented;
              return (
                <div key={provider.id} className="border-b border-border/50 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words text-[15px] font-semibold text-foreground">
                      {provider.name}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {getApiFamilyLabel(locale, provider.apiFamily)}
                      {!isRuntimeImplemented ? ` · ${t(locale, 'settings.ai.notAvailableYet')}` : ''}
                    </span>
                    {!provider.isEnabled ? (
                      <span className="text-xs text-muted-foreground">{t(locale, 'settings.ai.disabled')}</span>
                    ) : null}
                    <span className="flex-1" />
                    {!isEditingThisProvider ? (
                      <span className="flex items-center gap-1">
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
                        {provider.apiKeySet ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
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
                          className="text-destructive hover:text-destructive"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate({ kind: 'provider', id: provider.id })}
                        >
                          {t(locale, 'settings.delete')}
                        </Button>
                      </span>
                    ) : null}
                  </div>

                  {isEditingThisProvider && currentProvider ? (
                    <div className="mt-3">
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
                    <>
                      <p className="mt-2 text-[13px] text-muted-foreground">
                        {t(locale, 'settings.ai.apiKey')}{' '}
                        {provider.apiKeySet ? (
                          <span className="font-mono text-foreground">{provider.apiKeyMasked ?? '••••'}</span>
                        ) : (
                          <span className="text-destructive">{t(locale, 'settings.ai.keyNotSet')}</span>
                        )}
                      </p>

                      <div className="mt-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{t(locale, 'settings.ai.models')}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setAddingModelProviderId(provider.id);
                              openContext('model-add');
                            }}
                          >
                            {t(locale, 'settings.ai.addModel')}
                          </Button>
                        </div>
                        <div className="flex flex-col">
                          {providerModels.map((model) => {
                            const isEditingThisModel = editingContext === 'model' && editingModelId === model.id;
                            const testResult = modelTestResults[model.id];
                            const isTesting = modelTestMutation.isPending && modelTestMutation.variables === model.id;
                            if (isEditingThisModel) {
                              return (
                                <div key={model.id} className="border-t border-border/40 py-3">
                                  <ModelForm
                                    initialDraft={{
                                      modelId: model.modelId,
                                      label: model.label,
                                      wireVariant: model.wireVariant,
                                    }}
                                    family={provider.apiFamily}
                                    locale={locale}
                                    pending={modelMutation.isPending}
                                    submitLabel={t(locale, 'settings.ai.saveModel')}
                                    onSubmit={(draft) => modelMutation.mutate({ draft, model })}
                                    onCancel={closeContext}
                                  />
                                </div>
                              );
                            }
                            return (
                              <div key={model.id} className="border-t border-border/40 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="min-w-0 text-sm font-medium text-foreground">
                                    {model.label}
                                    {!model.isEnabled ? (
                                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                                        {t(locale, 'settings.ai.disabled')}
                                      </span>
                                    ) : null}
                                  </span>
                                  {model.label !== model.modelId ? (
                                    <span className="font-mono text-xs text-muted-foreground">{model.modelId}</span>
                                  ) : null}
                                  <span className="flex-1" />
                                  <span className="flex items-center gap-1">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={
                                        modelTestMutation.isPending ||
                                        !model.isEnabled ||
                                        !provider.isEnabled ||
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
                                      disabled={deleteMutation.isPending}
                                      onClick={() => deleteMutation.mutate({ kind: 'model', id: model.id })}
                                    >
                                      {t(locale, 'settings.delete')}
                                    </Button>
                                  </span>
                                </div>
                                {testResult?.status === 'success' ? (
                                  <p role="status" className="mt-1 text-xs text-muted-foreground">
                                    {t(locale, 'settings.ai.testSucceeded', {
                                      latencyMs: String(testResult.latencyMs),
                                    })}
                                  </p>
                                ) : null}
                                {testResult?.status === 'error' ? (
                                  <p role="alert" className="mt-1 text-xs text-destructive">
                                    {t(locale, 'settings.ai.testFailed', { message: testResult.message })}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })}
                          {!providerModels.length ? (
                            <p className="border-t border-border/40 py-3 text-sm text-muted-foreground">
                              {t(locale, 'settings.ai.noModels')}
                            </p>
                          ) : null}

                          {/* Add-model form renders inside the target provider's context. */}
                          {isAddingModelHere ? (
                            <ModelForm
                              className="border-t border-border/40 py-3"
                              initialDraft={EMPTY_MODEL}
                              family={provider.apiFamily}
                              locale={locale}
                              pending={modelMutation.isPending}
                              submitLabel={t(locale, 'settings.ai.addModelEntry')}
                              onSubmit={(draft) =>
                                modelMutation.mutate({ draft, model: null, providerId: provider.id })
                              }
                              onCancel={closeContext}
                            />
                          ) : null}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {!providers.length ? (
              <p className="py-3 text-sm text-muted-foreground">{t(locale, 'settings.ai.noProviders')}</p>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
