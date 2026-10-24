'use client';

import { useMemo, useState } from 'react';

import { type Locale, t } from '@gloaming/i18n';
import type { AiSettingKey, LlmAppSettingView, LlmModel, LlmProvider } from '@gloaming/shared/llm';
import { isRuntimeImplemented } from '@gloaming/shared/llm';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from '@/components/ui/combobox';
import { useLocale } from '@/lib/locale-context';

type ModelComboboxItem = {
  id: string;
  label: string;
  searchText: string;
  disabled?: boolean;
};

type ModelComboboxGroup = {
  value: string;
  label: string;
  items: ModelComboboxItem[];
};

type AiPurposePanelProps = {
  settings: LlmAppSettingView[];
  providers: LlmProvider[];
  models: LlmModel[];
  draftByKey: Partial<Record<AiSettingKey, string>>;
  onDraftChange: (key: AiSettingKey, modelId: string) => void;
  onSave: (key: AiSettingKey) => void;
};

const PURPOSE_TITLE_KEYS: Record<AiSettingKey, string> = {
  'assist.default_model_id': 'admin.ai.purpose.assist',
  'translate.default_model_id': 'admin.ai.purpose.translate',
  'metadata-enrich.default_model_id': 'admin.ai.purpose.metadataEnrich',
};

function purposeTitle(key: AiSettingKey, locale: Locale): string {
  return t(locale, PURPOSE_TITLE_KEYS[key]);
}

function modelRuntimeReady(model: LlmModel, providers: LlmProvider[]): boolean {
  const provider = providers.find((item) => item.id === model.providerId);
  if (!provider?.isEnabled || !model.isEnabled) {
    return false;
  }
  return isRuntimeImplemented(provider.apiFamily);
}

function resolveHealth(
  setting: LlmAppSettingView,
  models: LlmModel[],
  providers: LlmProvider[],
  locale: Locale,
): { label: string; tone: 'warn' | 'off' } | null {
  if (!setting.modelId) {
    return { label: t(locale, 'admin.ai.purpose.notConfigured'), tone: 'warn' };
  }
  const model = models.find((item) => item.id === setting.modelId);
  if (!model) {
    return { label: t(locale, 'admin.ai.purpose.modelDeleted'), tone: 'off' };
  }
  if (!model.isEnabled) {
    return { label: t(locale, 'admin.ai.purpose.modelDisabled'), tone: 'warn' };
  }
  const provider = providers.find((item) => item.id === model.providerId);
  if (!provider?.isEnabled) {
    return { label: t(locale, 'admin.ai.purpose.providerDisabled'), tone: 'warn' };
  }
  if (!isRuntimeImplemented(provider.apiFamily)) {
    return { label: t(locale, 'admin.ai.purpose.runtimeNotSupported'), tone: 'warn' };
  }
  return null;
}

function buildModelGroups(
  bindableModels: LlmModel[],
  providers: LlmProvider[],
  draftId: string,
  allModels: LlmModel[],
  locale: Locale,
  fallbackLabel?: string | null,
): ModelComboboxGroup[] {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const grouped = new Map<string, ModelComboboxItem[]>();
  const unknownProvider = t(locale, 'admin.ai.purpose.unknownProvider');

  for (const model of bindableModels) {
    const provider = providerById.get(model.providerId);
    const providerName = provider?.name ?? unknownProvider;
    const item: ModelComboboxItem = {
      id: model.id,
      label: model.label,
      searchText: `${providerName} ${model.label}`,
    };
    const items = grouped.get(model.providerId) ?? [];
    items.push(item);
    grouped.set(model.providerId, items);
  }

  const groups = [...grouped.entries()]
    .map(([providerId, items]) => ({
      value: providerId,
      label: providerById.get(providerId)?.name ?? unknownProvider,
      items: items.sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (draftId && !bindableModels.some((model) => model.id === draftId)) {
    const model = allModels.find((item) => item.id === draftId);
    const provider = model ? providerById.get(model.providerId) : undefined;
    const providerName = provider?.name ?? unknownProvider;
    groups.unshift({
      value: '__unavailable__',
      label: t(locale, 'admin.ai.purpose.currentBindingUnavailable'),
      items: [
        {
          id: draftId,
          label: model?.label ?? fallbackLabel ?? draftId,
          searchText: `${providerName} ${model?.label ?? fallbackLabel ?? draftId}`,
          disabled: true,
        },
      ],
    });
  }

  return groups;
}

function findModelItem(groups: ModelComboboxGroup[], modelId: string): ModelComboboxItem | null {
  for (const group of groups) {
    const match = group.items.find((item) => item.id === modelId);
    if (match) {
      return match;
    }
  }
  return null;
}

type PurposeModelComboboxProps = {
  id: string;
  ariaLabel: string;
  groups: ModelComboboxGroup[];
  value: string;
  disabled?: boolean;
  placeholder: string;
  onValueChange: (modelId: string) => void;
};

function PurposeModelCombobox({
  id,
  ariaLabel,
  groups,
  value,
  disabled,
  placeholder,
  onValueChange,
}: PurposeModelComboboxProps) {
  const { locale } = useLocale();
  const selected = value ? findModelItem(groups, value) : null;

  return (
    <Combobox
      items={groups}
      value={selected}
      disabled={disabled}
      itemToStringValue={(item) => item.searchText}
      isItemEqualToValue={(a, b) => a.id === b.id}
      onValueChange={(item) => {
        if (item && !item.disabled) {
          onValueChange(item.id);
        }
      }}
    >
      <ComboboxInput
        id={id}
        aria-label={ariaLabel}
        appearance="filled"
        placeholder={placeholder}
        className="h-11 w-full"
      />
      <ComboboxContent>
        <ComboboxEmpty>{t(locale, 'admin.ai.purpose.noMatchingModels')}</ComboboxEmpty>
        <ComboboxList>
          {(group) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxLabel>{group.label}</ComboboxLabel>
              <ComboboxCollection>
                {(item) => (
                  <ComboboxItem key={item.id} value={item} disabled={item.disabled}>
                    {item.label}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function AiPurposePanel({
  settings,
  providers,
  models,
  draftByKey,
  onDraftChange,
  onSave,
}: AiPurposePanelProps) {
  const { locale } = useLocale();
  // One inline editing context at a time; each purpose saves independently.
  const [editingKey, setEditingKey] = useState<AiSettingKey | null>(null);

  const bindableModels = useMemo(
    () =>
      models
        .filter((model) => modelRuntimeReady(model, providers))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [models, providers],
  );

  return (
    <ul className="flex flex-col">
      {settings.map((setting) => {
        const title = purposeTitle(setting.key, locale);
        const draft = draftByKey[setting.key] ?? setting.modelId ?? '';
        const savedModel = models.find((model) => model.id === (setting.modelId ?? ''));
        const health = resolveHealth(
          { ...setting, modelId: draft || null, healthy: Boolean(draft) },
          models,
          providers,
          locale,
        );
        const isDirty = draft !== (setting.modelId ?? '');
        const groups = buildModelGroups(bindableModels, providers, draft, models, locale, setting.modelLabel);
        const isEditing = editingKey === setting.key;

        return (
          <li key={setting.key} className="flex flex-col gap-3 border-b border-border/50 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  {health ? (
                    <Badge
                      variant="secondary"
                      className={
                        health.tone === 'warn' ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive'
                      }
                    >
                      {health.label}
                    </Badge>
                  ) : null}
                  {!setting.runtimeReady && setting.modelId ? (
                    <Badge variant="outline" className="text-xs font-normal">
                      {t(locale, 'admin.ai.purpose.bindingNotRunnable')}
                    </Badge>
                  ) : null}
                </div>
                {!isEditing ? (
                  <p className="text-sm text-foreground">
                    {setting.modelId
                      ? (setting.modelLabel ?? savedModel?.label ?? setting.modelId)
                      : t(locale, 'admin.ai.purpose.notSetRow')}
                  </p>
                ) : null}
              </div>
              {!isEditing ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-lg px-4"
                  onClick={() => setEditingKey(setting.key)}
                >
                  {t(locale, 'settings.change')}
                </Button>
              ) : null}
            </div>

            {isEditing ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <PurposeModelCombobox
                    id={`purpose-${setting.key}`}
                    ariaLabel={title}
                    groups={groups}
                    value={draft}
                    disabled={bindableModels.length === 0 && !draft}
                    placeholder={
                      bindableModels.length === 0
                        ? t(locale, 'admin.ai.purpose.noBindableModels')
                        : t(locale, 'admin.ai.purpose.searchOrSelectModel')
                    }
                    onValueChange={(modelId) => onDraftChange(setting.key, modelId)}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 rounded-lg px-4 hover:bg-brand-deep"
                  disabled={!draft || !isDirty}
                  onClick={() => onSave(setting.key)}
                >
                  {t(locale, 'admin.content.common.save')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // Local cancel discards only this row's draft.
                    if (isDirty) {
                      onDraftChange(setting.key, setting.modelId ?? '');
                    }
                    setEditingKey(null);
                  }}
                >
                  {t(locale, 'admin.content.common.cancel')}
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
