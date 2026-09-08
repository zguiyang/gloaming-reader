'use client';

import { useMemo } from 'react';

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

const AI_PURPOSE_TITLES: Record<AiSettingKey, string> = {
  'assist.default_model_id': '阅读助手',
  'translate.default_model_id': '双语翻译',
  'metadata-enrich.default_model_id': '元数据回填',
};

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
): { label: string; tone: 'warn' | 'off' } | null {
  if (!setting.modelId) {
    return { label: '未配置', tone: 'warn' };
  }
  const model = models.find((item) => item.id === setting.modelId);
  if (!model) {
    return { label: '模型已删除', tone: 'off' };
  }
  if (!model.isEnabled) {
    return { label: '模型已停用', tone: 'warn' };
  }
  const provider = providers.find((item) => item.id === model.providerId);
  if (!provider?.isEnabled) {
    return { label: '服务商已停用', tone: 'warn' };
  }
  if (!isRuntimeImplemented(provider.apiFamily)) {
    return { label: '运行时尚未支持', tone: 'warn' };
  }
  return null;
}

function buildModelGroups(
  bindableModels: LlmModel[],
  providers: LlmProvider[],
  draftId: string,
  allModels: LlmModel[],
  fallbackLabel?: string | null,
): ModelComboboxGroup[] {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const grouped = new Map<string, ModelComboboxItem[]>();

  for (const model of bindableModels) {
    const provider = providerById.get(model.providerId);
    const providerName = provider?.name ?? '未知服务商';
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
      label: providerById.get(providerId)?.name ?? '未知服务商',
      items: items.sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (draftId && !bindableModels.some((model) => model.id === draftId)) {
    const model = allModels.find((item) => item.id === draftId);
    const provider = model ? providerById.get(model.providerId) : undefined;
    const providerName = provider?.name ?? '未知服务商';
    groups.unshift({
      value: '__unavailable__',
      label: '当前绑定（不可用）',
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
  groups: ModelComboboxGroup[];
  value: string;
  disabled?: boolean;
  placeholder: string;
  onValueChange: (modelId: string) => void;
};

function PurposeModelCombobox({ id, groups, value, disabled, placeholder, onValueChange }: PurposeModelComboboxProps) {
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
      <ComboboxInput id={id} placeholder={placeholder} className="h-10 w-full rounded-xl" />
      <ComboboxContent>
        <ComboboxEmpty>没有匹配的模型</ComboboxEmpty>
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
  const bindableModels = useMemo(
    () =>
      models
        .filter((model) => modelRuntimeReady(model, providers))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [models, providers],
  );

  return (
    <ul className="overflow-hidden rounded-2xl border border-border bg-secondary/60">
      {settings.map((setting) => {
        const title = AI_PURPOSE_TITLES[setting.key];
        const draft = draftByKey[setting.key] ?? setting.modelId ?? '';
        const health = resolveHealth(
          { ...setting, modelId: draft || null, healthy: Boolean(draft) },
          models,
          providers,
        );
        const isDirty = draft !== (setting.modelId ?? '');
        const groups = buildModelGroups(bindableModels, providers, draft, models, setting.modelLabel);

        return (
          <li
            key={setting.key}
            className="flex flex-col gap-3 border-t border-border/80 px-5 py-5 first:border-t-0 md:flex-row md:items-center md:gap-6 md:px-6 md:py-5"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2 md:w-40 md:shrink-0">
              <p className="font-medium text-foreground">{title}</p>
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
                  当前绑定不可运行
                </Badge>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-3">
              <PurposeModelCombobox
                id={`purpose-${setting.key}`}
                groups={groups}
                value={draft}
                disabled={bindableModels.length === 0 && !draft}
                placeholder={bindableModels.length === 0 ? '暂无可绑定模型' : '搜索或选择模型'}
                onValueChange={(modelId) => onDraftChange(setting.key, modelId)}
              />
              <Button
                className="h-10 shrink-0 rounded-xl px-5 hover:bg-brand-deep"
                disabled={!draft || !isDirty}
                onClick={() => onSave(setting.key)}
              >
                保存
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
