'use client';

import { ChevronDownIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { t } from '@/i18n';
import { LLM_API_FAMILIES, LLM_WIRE_REGISTRY, type LlmApiFamily, type LlmProvider } from '@/shared/llm';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SecretField } from '@/components/ui/secret-field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getApiFamilyLabel } from '@/lib/llm-protocol-labels';
import { useLocale } from '@/lib/locale-context';

export type ProviderDraft = {
  apiFamily: LlmApiFamily;
  name: string;
  baseUrl: string;
  apiKey: string;
  proxyUrl: string;
  thinkingParam: string;
};

export const EMPTY_PROVIDER: ProviderDraft = {
  apiFamily: 'openai',
  name: '',
  baseUrl: '',
  apiKey: '',
  proxyUrl: '',
  thinkingParam: '',
};

export function ProviderForm({
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
            <Select
              value={draft.apiFamily}
              items={LLM_API_FAMILIES.map((familyId) => ({
                value: familyId,
                label: `${getApiFamilyLabel(locale, familyId)}${!LLM_WIRE_REGISTRY[familyId].runtimeImplemented ? ` · ${t(locale, 'settings.ai.notAvailableYet')}` : ''}`,
              }))}
              onValueChange={(value) => {
                if (value && LLM_API_FAMILIES.includes(value as LlmApiFamily))
                  setDraft((current) => ({ ...current, apiFamily: value as LlmApiFamily }));
              }}
            >
              <SelectTrigger id="settings-provider-family" appearance="filled" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {LLM_API_FAMILIES.map((familyId) => (
                    <SelectItem key={familyId} value={familyId}>
                      {getApiFamilyLabel(locale, familyId)}
                      {!LLM_WIRE_REGISTRY[familyId].runtimeImplemented
                        ? ` · ${t(locale, 'settings.ai.notAvailableYet')}`
                        : ''}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
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
        <Collapsible className="border-t border-border/50 pt-3">
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="plain"
                size={null}
                className="group gap-1 cursor-pointer text-sm text-muted-foreground"
              />
            }
          >
            {t(locale, 'settings.ai.advanced')}
            <ChevronDownIcon className="size-4 transition-transform group-data-panel-open:rotate-180" aria-hidden />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 grid gap-4 sm:grid-cols-2">
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
              <p className="text-xs text-muted-foreground">{t(locale, 'settings.ai.proxyUrlHint')}</p>
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
          </CollapsibleContent>
        </Collapsible>
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
        <Button
          type="submit"
          className="h-11 rounded-[8px] px-6 dark:bg-[var(--brand-deep)] dark:hover:bg-[var(--brand-deep)]"
          disabled={pending}
        >
          {pending ? t(locale, 'settings.saving') : t(locale, 'settings.save')}
        </Button>
      </div>
    </form>
  );
}
