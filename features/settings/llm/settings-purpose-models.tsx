'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@/i18n';
import { type AiSettingKey } from '@/shared/llm';

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
import {
  formatUserSettingsApiError,
  listAvailableInstanceModels,
  listUserLlmSettings,
  putUserLlmSetting,
  userSettingsQueryKey,
} from '@/features/settings/settings-api';
import { useLocale } from '@/lib/locale-context';

const PURPOSES: Array<{ key: AiSettingKey; labelKey: string }> = [
  { key: 'assist.default_model_id', labelKey: 'assist' },
  { key: 'translate.default_model_id', labelKey: 'translate' },
];

function modelDisplayName(model: { label: string }, fallback = ''): string {
  return model.label.trim() || fallback;
}

/** Closed trigger keeps provider context; list rows use the group header instead. */
function selectedModelLabel(model: { label: string }, providerName: string): string {
  const name = modelDisplayName(model, providerName);
  if (!providerName || name === providerName) {
    return name;
  }
  return `${name} · ${providerName}`;
}

export function SettingsPurposeModels({ enabled }: { enabled: boolean }) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [purposeDraft, setPurposeDraft] = useState<Partial<Record<AiSettingKey, string>>>({});

  const settingsQuery = useQuery({
    queryKey: userSettingsQueryKey.settings(),
    queryFn: ({ signal }) => listUserLlmSettings(signal),
    enabled,
  });
  const availableQuery = useQuery({
    queryKey: userSettingsQueryKey.availableModels(),
    queryFn: ({ signal }) => listAvailableInstanceModels(signal),
    enabled,
  });

  const settingMutation = useMutation({
    mutationFn: ({ key, modelId }: { key: AiSettingKey; modelId: string }) => putUserLlmSetting(key, { modelId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userSettingsQueryKey.settings() });
      toast.success(t(locale, 'settings.saved'));
    },
    onError: (error) => toast.error(formatUserSettingsApiError(error)),
  });

  const settings = settingsQuery.data ?? [];
  const providers = availableQuery.data?.providers ?? [];
  const models = availableQuery.data?.models ?? [];
  const loadError = settingsQuery.error ?? availableQuery.error;
  const isPending = settingsQuery.isPending || availableQuery.isPending;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-xl font-semibold">{t(locale, 'settings.ai.capabilities')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(locale, 'settings.ai.capabilitiesDescription')}</p>
      </div>

      {isPending ? <p className="text-sm text-muted-foreground">{t(locale, 'settings.loading')}</p> : null}
      {loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {formatUserSettingsApiError(loadError)}
        </p>
      ) : null}

      {!isPending && !loadError ? (
        <div className="flex flex-col">
          <p className="mb-3 text-xs text-muted-foreground">{t(locale, 'settings.ai.defaultOnUnset')}</p>
          {PURPOSES.map(({ key, labelKey }) => {
            const setting = settings.find((item) => item.key === key);
            const saved = setting?.modelId ?? '';
            const savedIsAvailable = Boolean(saved) && models.some((model) => model.id === saved);
            const isSavedUnavailable = Boolean(saved) && !savedIsAvailable;
            // Draft wins; an unavailable saved binding is not a selectable value.
            const selected = purposeDraft[key] !== undefined ? purposeDraft[key] : savedIsAvailable ? saved : '';
            const isDirty = selected !== (savedIsAvailable ? saved : '');
            const isSelectorDisabled = models.length === 0 || settingMutation.isPending;
            const selectedModel = models.find((model) => model.id === selected);
            const selectedProvider =
              selectedModel && providers.find((provider) => provider.id === selectedModel.providerId);
            const optionGroups = providers
              .map((provider) => ({
                provider,
                models: models.filter((model) => model.providerId === provider.id),
              }))
              .filter((group) => group.models.length > 0);
            const selectedLabel = selectedModel
              ? selectedModelLabel(selectedModel, selectedProvider?.name ?? '')
              : isSavedUnavailable && purposeDraft[key] === undefined
                ? t(locale, 'settings.ai.unavailablePickAgain')
                : t(locale, 'settings.ai.notSet');
            const hasSaveError =
              settingMutation.isError &&
              settingMutation.variables?.key === key &&
              isDirty &&
              selected === settingMutation.variables?.modelId;

            return (
              <div
                key={key}
                className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-0 border-b border-border/50 py-3 [grid-template-areas:'name_actions'_'select_select'_'note_note'] sm:grid-cols-[148px_minmax(0,1fr)] sm:gap-x-4 sm:[grid-template-areas:'name_select'_'._actions'_'note_note']"
              >
                <div className="[grid-area:name] flex min-h-[44px] items-center sm:min-h-0">
                  <label htmlFor={`purpose-${key}`} className="text-sm font-semibold text-foreground">
                    {t(locale, `settings.ai.purpose.${labelKey}`)}
                  </label>
                </div>
                <div className="[grid-area:select] min-w-0">
                  <Select
                    value={selected || null}
                    disabled={isSelectorDisabled}
                    onValueChange={(value) => {
                      if (!value) return;
                      setPurposeDraft((current) => ({ ...current, [key]: value }));
                    }}
                  >
                    <SelectTrigger id={`purpose-${key}`} appearance="filled" className="h-11 w-full">
                      <SelectValue placeholder={t(locale, 'settings.ai.notSet')}>{selectedLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {optionGroups.map((group) => (
                        <SelectGroup key={group.provider.id}>
                          <SelectLabel>{group.provider.name}</SelectLabel>
                          {group.models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {modelDisplayName(model, group.provider.name)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="[grid-area:actions] flex min-h-10 items-center justify-end gap-2">
                  {isDirty && selected ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        disabled={settingMutation.isPending}
                        onClick={() => {
                          settingMutation.mutate({ key, modelId: selected });
                          setPurposeDraft((current) => {
                            const next = { ...current };
                            delete next[key];
                            return next;
                          });
                        }}
                      >
                        {t(locale, 'settings.save')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setPurposeDraft((current) => {
                            const next = { ...current };
                            delete next[key];
                            return next;
                          })
                        }
                      >
                        {t(locale, 'settings.cancel')}
                      </Button>
                    </>
                  ) : (
                    <span className="invisible text-sm" aria-hidden>
                      {t(locale, 'settings.save')}
                    </span>
                  )}
                </div>
                {isSavedUnavailable && purposeDraft[key] === undefined ? (
                  <p className="[grid-area:note] text-xs text-muted-foreground">
                    {t(locale, 'settings.ai.unavailablePickAgain')}
                  </p>
                ) : null}
                {hasSaveError ? (
                  <p role="alert" className="[grid-area:note] text-xs text-destructive">
                    {t(locale, 'settings.ai.purposeSaveFailed')}
                  </p>
                ) : null}
              </div>
            );
          })}
          {models.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t(locale, 'settings.ai.noInstanceModels')}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
