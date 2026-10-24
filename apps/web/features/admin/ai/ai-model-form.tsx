'use client';

import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { t } from '@gloaming/i18n';
import type { LlmApiFamily, LlmModel, LlmProvider, ProviderModelCandidate } from '@gloaming/shared/llm';
import { getDefaultWireVariant, getWireFamilyDefinition } from '@gloaming/shared/llm';

import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { fetchLlmProviderModels, formatAdminLlmApiError } from '@/features/admin/ai/ai-config-api';
import { getWireVariantDisplayLabel } from '@/features/admin/ai/ai-locale';
import { useLocale } from '@/lib/locale-context';

export type ModelFormValues = {
  modelId: string;
  label: string;
  wireVariant: string;
  temperature: string;
  maxTokens: string;
  contextLength: string;
  isEnabled: boolean;
  sortOrder: string;
};

type AiModelFormProps = {
  formId: string;
  provider: LlmProvider;
  model: LlmModel | null;
  onSubmit: (values: ModelFormValues) => void;
  onCancel: () => void;
  /** Object-save pending; disables actions during the current save. */
  pending?: boolean;
};

function emptyValues(apiFamily: LlmApiFamily): ModelFormValues {
  return {
    modelId: '',
    label: '',
    wireVariant: getDefaultWireVariant(apiFamily),
    temperature: '0.3',
    maxTokens: '2048',
    contextLength: '',
    isEnabled: true,
    sortOrder: '0',
  };
}

function fromModel(model: LlmModel): ModelFormValues {
  return {
    modelId: model.modelId,
    label: model.label,
    wireVariant: model.wireVariant,
    temperature: model.temperature != null ? String(model.temperature) : '',
    maxTokens: model.maxTokens != null ? String(model.maxTokens) : '',
    contextLength: model.contextLength != null ? String(model.contextLength) : '',
    isEnabled: model.isEnabled,
    sortOrder: String(model.sortOrder),
  };
}

export function AiModelForm({ formId, provider, model, onSubmit, onCancel, pending = false }: AiModelFormProps) {
  const { locale } = useLocale();
  const familyDef = getWireFamilyDefinition(provider.apiFamily);
  const isEdit = model != null;
  const [values, setValues] = useState<ModelFormValues>(() =>
    model ? fromModel(model) : emptyValues(provider.apiFamily),
  );
  const [errors, setErrors] = useState<Partial<Record<keyof ModelFormValues, string>>>({});
  const [candidates, setCandidates] = useState<ProviderModelCandidate[] | null>(null);
  const [pickedModelId, setPickedModelId] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const wireVariantOptions = familyDef.wireVariants;
  const canFetchModels = familyDef.provider.capabilities.modelList;

  function applyCandidate(candidate: ProviderModelCandidate) {
    setPickedModelId(candidate.id);
    setValues((prev) => ({
      ...prev,
      modelId: candidate.id,
      label: candidate.label,
      contextLength: candidate.contextLength != null ? String(candidate.contextLength) : prev.contextLength,
      maxTokens: candidate.maxOutputTokens != null ? String(candidate.maxOutputTokens) : prev.maxTokens,
    }));
  }

  async function loadPlatformModels() {
    setIsFetching(true);
    setFetchError(null);
    try {
      const result = await fetchLlmProviderModels(provider.id);
      setCandidates(result.models);
      setPickedModelId(null);
    } catch (error) {
      setFetchError(formatAdminLlmApiError(error));
      setCandidates(null);
    } finally {
      setIsFetching(false);
    }
  }

  function validate(): boolean {
    const next: Partial<Record<keyof ModelFormValues, string>> = {};
    if (!values.modelId.trim()) {
      next.modelId = t(locale, 'admin.ai.model.validation.modelIdRequired');
    }
    if (!values.label.trim()) {
      next.label = t(locale, 'admin.ai.model.validation.labelRequired');
    }
    if (!wireVariantOptions.some((option) => option.id === values.wireVariant)) {
      next.wireVariant = t(locale, 'admin.ai.model.validation.wireVariantInvalid');
    }
    if (values.temperature.trim()) {
      const temperature = Number(values.temperature);
      if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
        next.temperature = t(locale, 'admin.ai.model.validation.temperatureRange');
      }
    }
    if (values.maxTokens.trim()) {
      const maxTokens = Number(values.maxTokens);
      if (!Number.isInteger(maxTokens) || maxTokens < 1) {
        next.maxTokens = t(locale, 'admin.ai.model.validation.maxTokensPositive');
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  const selectedPlatformModel = candidates?.find((item) => item.id === pickedModelId) ?? null;

  return (
    <form
      id={formId}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!validate()) {
          return;
        }
        onSubmit(values);
      }}
    >
      <FieldGroup className="gap-4">
        {!isEdit && canFetchModels ? (
          <Field>
            <FieldLabel htmlFor={`${formId}-platform-model`}>{t(locale, 'admin.ai.model.platformModel')}</FieldLabel>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Combobox
                  items={candidates ?? []}
                  value={selectedPlatformModel}
                  disabled={!candidates?.length}
                  itemToStringValue={(item) => (item.label === item.id ? item.id : `${item.label} ${item.id}`)}
                  isItemEqualToValue={(a, b) => a.id === b.id}
                  onValueChange={(item) => {
                    if (item) {
                      applyCandidate(item);
                    }
                  }}
                >
                  <ComboboxInput
                    id={`${formId}-platform-model`}
                    aria-label={t(locale, 'admin.ai.model.platformModel')}
                    appearance="filled"
                    placeholder={
                      candidates?.length
                        ? t(locale, 'admin.ai.model.searchOrSelectPlatform')
                        : t(locale, 'admin.ai.model.refreshThenSelect')
                    }
                    className="h-11 w-full"
                  />
                  <ComboboxContent>
                    <ComboboxEmpty>{t(locale, 'admin.ai.model.noMatchingModels')}</ComboboxEmpty>
                    <ComboboxList>
                      {(item) => (
                        <ComboboxItem key={item.id} value={item}>
                          {item.label}
                          {item.label !== item.id ? (
                            <span className="font-mono text-xs text-muted-foreground">{item.id}</span>
                          ) : null}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0 rounded-lg"
                disabled={isFetching}
                aria-label={
                  isFetching
                    ? t(locale, 'admin.ai.model.refreshingPlatformListAria')
                    : t(locale, 'admin.ai.model.refreshPlatformListAria')
                }
                onClick={() => void loadPlatformModels()}
              >
                {isFetching ? <Spinner /> : <RefreshCw className="size-4" />}
              </Button>
            </div>
            {fetchError ? <p className="text-xs text-destructive">{fetchError}</p> : null}
          </Field>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field data-invalid={Boolean(errors.label) || undefined}>
            <FieldLabel htmlFor={`${formId}-label`}>{t(locale, 'admin.ai.model.displayName')}</FieldLabel>
            <Input
              id={`${formId}-label`}
              appearance="filled"
              className="h-11"
              aria-invalid={Boolean(errors.label) || undefined}
              aria-describedby={errors.label ? `${formId}-label-error` : undefined}
              value={values.label}
              onChange={(e) => setValues((p) => ({ ...p, label: e.target.value }))}
            />
            <FieldError id={`${formId}-label-error`}>{errors.label}</FieldError>
          </Field>
          <Field data-invalid={Boolean(errors.modelId) || undefined}>
            <FieldLabel htmlFor={`${formId}-model-id`}>{t(locale, 'admin.ai.model.modelId')}</FieldLabel>
            <Input
              id={`${formId}-model-id`}
              appearance="filled"
              className="h-11 font-mono text-sm"
              aria-invalid={Boolean(errors.modelId) || undefined}
              aria-describedby={errors.modelId ? `${formId}-model-id-error` : undefined}
              value={values.modelId}
              onChange={(e) => setValues((p) => ({ ...p, modelId: e.target.value }))}
            />
            <FieldError id={`${formId}-model-id-error`}>{errors.modelId}</FieldError>
          </Field>
        </div>

        <Field data-invalid={Boolean(errors.wireVariant) || undefined}>
          <FieldLabel htmlFor={`${formId}-wire-variant`}>{t(locale, 'admin.ai.model.apiMode')}</FieldLabel>
          <Select
            items={wireVariantOptions.map((option) => ({
              value: option.id,
              label: getWireVariantDisplayLabel(locale, provider.apiFamily, option.id),
            }))}
            value={values.wireVariant}
            onValueChange={(value) => {
              if (value != null) {
                setValues((p) => ({ ...p, wireVariant: value }));
              }
            }}
          >
            <SelectTrigger
              id={`${formId}-wire-variant`}
              appearance="filled"
              aria-invalid={Boolean(errors.wireVariant) || undefined}
              aria-describedby={errors.wireVariant ? `${formId}-wire-variant-error` : undefined}
              className="h-11 w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {wireVariantOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {getWireVariantDisplayLabel(locale, provider.apiFamily, option.id)}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{option.endpoint}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldError id={`${formId}-wire-variant-error`}>{errors.wireVariant}</FieldError>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${formId}-temperature`}>{t(locale, 'admin.ai.model.temperature')}</FieldLabel>
            <Input
              id={`${formId}-temperature`}
              appearance="filled"
              className="h-11"
              value={values.temperature}
              onChange={(e) => setValues((p) => ({ ...p, temperature: e.target.value }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${formId}-max-tokens`}>{t(locale, 'admin.ai.model.maxTokens')}</FieldLabel>
            <Input
              id={`${formId}-max-tokens`}
              appearance="filled"
              className="h-11"
              value={values.maxTokens}
              onChange={(e) => setValues((p) => ({ ...p, maxTokens: e.target.value }))}
            />
          </Field>
        </div>

        <Field orientation="horizontal" className="items-center justify-between">
          <FieldLabel htmlFor={`${formId}-enabled`}>{t(locale, 'admin.ai.model.callable')}</FieldLabel>
          <Switch
            id={`${formId}-enabled`}
            checked={values.isEnabled}
            onCheckedChange={(checked) => setValues((p) => ({ ...p, isEnabled: checked }))}
          />
        </Field>
      </FieldGroup>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-11 rounded-[8px] px-6 hover:bg-brand-deep" disabled={pending}>
          {pending
            ? t(locale, 'admin.content.common.saving')
            : isEdit
              ? t(locale, 'admin.ai.model.saveModel')
              : t(locale, 'admin.ai.model.addModel')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-[8px] px-6"
          disabled={pending}
          onClick={onCancel}
        >
          {t(locale, 'admin.content.common.cancel')}
        </Button>
      </div>
    </form>
  );
}
