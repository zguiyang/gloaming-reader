'use client';

import { useMemo } from 'react';

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
  /** Key whose save request is in flight, or null. */
  savingKey: AiSettingKey | null;
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
  savingKey,
  onDraftChange,
  onSave,
}: AiPurposePanelProps) {
  const { locale } = useLocale();

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
        const health = resolveHealth(
          { ...setting, modelId: draft || null, healthy: Boolean(draft) },
          models,
          providers,
          locale,
        );
        const isDirty = draft !== (setting.modelId ?? '');
        const groups = buildModelGroups(bindableModels, providers, draft, models, locale, setting.modelLabel);
        // Any purpose save in flight gates every row: saves and selectors stay
        // locked so concurrent mutations cannot overwrite each other's variables.
        const isAnySaving = savingKey !== null;

        return (
          <li
            key={setting.key}
            className="flex flex-col gap-3 border-b border-border/50 py-4 sm:flex-row sm:items-start sm:gap-4"
          >
            {/* Purpose name + health badges: fixed-basis left column on desktop-wide rows so the
                selector can fill the remaining width up to the content right edge; stacks
                naturally above the selector on narrow screens. Top alignment keeps the title and
                selector steady when badges appear or long titles wrap. */}
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:w-48 sm:shrink-0 sm:flex-col sm:items-start sm:gap-1.5 lg:w-56">
              {/* Desktop: the title band matches the selector's 44px height so a normal
                  single-line name sits on the selector's vertical center; a wrapped long title
                  grows the band instead of clipping. Narrow keeps the plain stacked title. */}
              <div className="flex min-w-0 items-center sm:min-h-[44px]">
                <p className="min-w-0 text-sm font-semibold text-foreground">{title}</p>
              </div>
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
            {/* The selector spans the full remaining row width, so its right edge stays flush with
                the content right edge in every state. Save/Cancel sit below it, right-aligned, in
                a constant-height reserved slot: dirty, pending, error, and cancel states never
                shift the selector, its right edge, or neighboring rows. */}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="min-w-0 w-full">
                <PurposeModelCombobox
                  id={`purpose-${setting.key}`}
                  ariaLabel={title}
                  groups={groups}
                  value={draft}
                  disabled={(bindableModels.length === 0 && !draft) || isAnySaving}
                  placeholder={
                    bindableModels.length === 0
                      ? t(locale, 'admin.ai.purpose.noBindableModels')
                      : t(locale, 'admin.ai.purpose.searchOrSelectModel')
                  }
                  onValueChange={(modelId) => onDraftChange(setting.key, modelId)}
                />
              </div>
              <div className="flex h-9 w-full items-center justify-end gap-2" aria-hidden={isDirty ? undefined : true}>
                {isDirty ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 rounded-lg px-4 hover:bg-brand-deep"
                      disabled={!draft || isAnySaving}
                      onClick={() => onSave(setting.key)}
                    >
                      {t(locale, 'admin.content.common.save')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isAnySaving}
                      onClick={() => {
                        // Local cancel restores only this row's saved binding.
                        onDraftChange(setting.key, setting.modelId ?? '');
                      }}
                    >
                      {t(locale, 'admin.content.common.cancel')}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
