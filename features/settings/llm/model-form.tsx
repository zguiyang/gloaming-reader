'use client';

import { type Dispatch, type SetStateAction, useState } from 'react';

import { t } from '@/i18n';
import { LLM_WIRE_REGISTRY, type LlmApiFamily } from '@/shared/llm';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getWireVariantDisplayLabel } from '@/lib/llm-protocol-labels';
import { cn } from '@/lib/utils';

export type ModelDraft = { modelId: string; label: string; wireVariant: string };

export const EMPTY_MODEL: ModelDraft = { modelId: '', label: '', wireVariant: 'chat-completions' };

/**
 * Owns the model draft so typing re-renders only this form. The page used to
 * hold the draft, which re-rendered every provider, model row and mutation on
 * each keystroke.
 */
export function ModelForm({
  initialDraft,
  family,
  locale,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
  className,
}: {
  initialDraft: ModelDraft;
  family: LlmApiFamily;
  locale: 'en-US' | 'zh-CN';
  pending: boolean;
  submitLabel: string;
  onSubmit: (draft: ModelDraft) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<ModelDraft>(initialDraft);

  return (
    <form
      className={cn('flex flex-col gap-4', className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <ModelFields draft={draft} setDraft={setDraft} family={family} locale={locale} />
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-[8px] px-6"
          disabled={pending}
          onClick={onCancel}
        >
          {t(locale, 'settings.ai.cancelChanges')}
        </Button>
        <Button
          type="submit"
          className="h-11 rounded-[8px] px-6 dark:bg-[var(--brand-deep)] dark:hover:bg-[var(--brand-deep)]"
          disabled={pending}
        >
          {pending ? t(locale, 'settings.saving') : submitLabel}
        </Button>
      </div>
    </form>
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
    <div className="flex w-full flex-col gap-4">
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
        <Select
          value={draft.wireVariant}
          items={LLM_WIRE_REGISTRY[family].wireVariants.map((variant) => ({
            value: variant.id,
            label: getWireVariantDisplayLabel(locale, family, variant.id),
          }))}
          onValueChange={(value) => {
            if (value) setDraft((v) => ({ ...v, wireVariant: value }));
          }}
        >
          <SelectTrigger id="settings-wire-variant" appearance="filled" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {LLM_WIRE_REGISTRY[family].wireVariants.map((variant) => (
                <SelectItem key={variant.id} value={variant.id}>
                  {getWireVariantDisplayLabel(locale, family, variant.id)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
