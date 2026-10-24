'use client';

import { ChevronDown, Globe, Wallet } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { t } from '@gloaming/i18n';
import type { LlmApiFamily, LlmProvider } from '@gloaming/shared/llm';
import { getWireFamilyDefinition, providerSupportsOptionalField } from '@gloaming/shared/llm';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SecretField } from '@/components/ui/secret-field';
import { getApiFamilyLabel } from '@/features/admin/ai/ai-locale';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

export type ProviderFormValues = {
  name: string;
  baseUrl: string;
  apiKey: string;
  proxyUrl: string;
  thinkingParam: string;
  balanceEndpoint: string;
  balanceAmountPath: string;
  balanceCurrencyPath: string;
};

type AiProviderFormProps = {
  apiFamily: LlmApiFamily;
  provider: LlmProvider | null;
  formId: string;
  onSubmit: (values: ProviderFormValues) => void;
  onCancel?: () => void;
  /** Object-save pending; disables actions and the secret replacement draft. */
  pending?: boolean;
};

export function emptyProviderValues(apiFamily: LlmApiFamily): ProviderFormValues {
  const familyDef = getWireFamilyDefinition(apiFamily);
  return {
    name: '',
    baseUrl: familyDef.provider.baseUrlPlaceholder,
    apiKey: '',
    proxyUrl: '',
    thinkingParam: '',
    balanceEndpoint: '',
    balanceAmountPath: '',
    balanceCurrencyPath: '',
  };
}

export function providerValuesFromRow(provider: LlmProvider): ProviderFormValues {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: '',
    proxyUrl: provider.proxyUrl ?? '',
    thinkingParam: provider.thinkingParam ?? '',
    balanceEndpoint: provider.balanceEndpoint ?? '',
    balanceAmountPath: provider.balanceAmountPath ?? '',
    balanceCurrencyPath: provider.balanceCurrencyPath ?? '',
  };
}

function CollapsibleSection({
  icon,
  title,
  open,
  onToggle,
  children,
}: {
  icon: typeof Globe;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const Icon = icon;
  return (
    <div className="rounded-xl border border-border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        {title}
        <ChevronDown
          className={cn('ml-auto size-4 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? <div className="flex flex-col gap-3 border-t border-border px-4 py-4">{children}</div> : null}
    </div>
  );
}

export function AiProviderForm({
  apiFamily,
  provider,
  formId,
  onSubmit,
  onCancel,
  pending = false,
}: AiProviderFormProps) {
  const { locale } = useLocale();
  const familyDef = getWireFamilyDefinition(apiFamily);
  const isEdit = provider != null;
  const [values, setValues] = useState<ProviderFormValues>(() =>
    provider ? providerValuesFromRow(provider) : emptyProviderValues(apiFamily),
  );
  const [errors, setErrors] = useState<Partial<Record<keyof ProviderFormValues, string>>>({});
  const [isReplacingKey, setIsReplacingKey] = useState(false);
  const [isProxyOpen, setIsProxyOpen] = useState(() => Boolean(provider?.proxyUrl));
  const [isBalanceOpen, setIsBalanceOpen] = useState(() =>
    Boolean(provider?.balanceEndpoint || provider?.balanceAmountPath),
  );

  const shouldShowThinkingParam = providerSupportsOptionalField(apiFamily, 'thinkingParam');
  const shouldShowBalance = familyDef.provider.capabilities.balanceQuery;

  function validate(): boolean {
    const next: Partial<Record<keyof ProviderFormValues, string>> = {};
    if (!values.name.trim()) {
      next.name = t(locale, 'admin.ai.provider.validation.nameRequired');
    }
    if (!values.baseUrl.trim()) {
      next.baseUrl = t(locale, 'admin.ai.provider.validation.baseUrlRequired');
    } else {
      try {
        new URL(values.baseUrl.trim());
      } catch {
        next.baseUrl = t(locale, 'admin.ai.provider.validation.baseUrlInvalid');
      }
    }
    if (!isEdit && !values.apiKey.trim()) {
      next.apiKey = t(locale, 'admin.ai.provider.validation.apiKeyRequired');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  return (
    <form
      id={formId}
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!validate()) {
          return;
        }
        onSubmit(values);
      }}
    >
      {!isEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{getApiFamilyLabel(locale, apiFamily)}</Badge>
          {!familyDef.runtimeImplemented ? (
            <Badge variant="outline" className="text-xs font-normal">
              {t(locale, 'admin.ai.provider.runtimeNotSupported')}
            </Badge>
          ) : null}
        </div>
      ) : null}

      <FieldGroup className="gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field data-invalid={Boolean(errors.name) || undefined}>
            <FieldLabel htmlFor={`${formId}-name`}>{t(locale, 'admin.ai.provider.form.name')}</FieldLabel>
            <Input
              id={`${formId}-name`}
              appearance="filled"
              className="h-11"
              aria-invalid={Boolean(errors.name) || undefined}
              aria-describedby={errors.name ? `${formId}-name-error` : undefined}
              value={values.name}
              onChange={(e) => setValues((p) => ({ ...p, name: e.target.value }))}
            />
            <FieldError id={`${formId}-name-error`}>{errors.name}</FieldError>
          </Field>
          <Field data-invalid={Boolean(errors.baseUrl) || undefined}>
            <FieldLabel htmlFor={`${formId}-base-url`}>{t(locale, 'admin.ai.provider.form.baseUrl')}</FieldLabel>
            <Input
              id={`${formId}-base-url`}
              appearance="filled"
              className="h-11 font-mono text-sm"
              aria-invalid={Boolean(errors.baseUrl) || undefined}
              aria-describedby={errors.baseUrl ? `${formId}-base-url-error` : undefined}
              value={values.baseUrl}
              placeholder={familyDef.provider.baseUrlPlaceholder}
              onChange={(e) => setValues((p) => ({ ...p, baseUrl: e.target.value }))}
            />
            <FieldError id={`${formId}-base-url-error`}>{errors.baseUrl}</FieldError>
          </Field>
        </div>

        {isEdit ? (
          <SecretField
            id={`${formId}-api-key`}
            label={t(locale, 'admin.ai.provider.form.apiKey')}
            isSet={Boolean(provider?.apiKeySet)}
            masked={provider?.apiKeyMasked}
            value={values.apiKey}
            onChange={(value) => {
              setValues((p) => ({ ...p, apiKey: value }));
            }}
            replacing={isReplacingKey}
            onReplace={() => setIsReplacingKey(true)}
            onCancelReplace={() => {
              setValues((p) => ({ ...p, apiKey: '' }));
              setIsReplacingKey(false);
            }}
            error={errors.apiKey}
            disabled={pending}
            placeholderWhenSet={t(locale, 'admin.ai.provider.form.apiKeyPlaceholderEdit')}
            copy={{
              replaceLabel: t(locale, 'common.secret.newKey'),
              replaceAction: t(locale, 'common.secret.replace'),
              cancelReplaceAction: t(locale, 'common.secret.cancelReplace'),
              keepHint: t(locale, 'common.secret.keepHint'),
              configuredLabel: t(locale, 'common.secret.configured'),
            }}
          />
        ) : (
          <Field data-invalid={Boolean(errors.apiKey) || undefined}>
            <FieldLabel htmlFor={`${formId}-api-key`}>{t(locale, 'admin.ai.provider.form.apiKey')}</FieldLabel>
            <Input
              id={`${formId}-api-key`}
              type="password"
              appearance="filled"
              className="h-11"
              autoComplete="off"
              aria-invalid={Boolean(errors.apiKey) || undefined}
              aria-describedby={errors.apiKey ? `${formId}-api-key-error` : undefined}
              value={values.apiKey}
              placeholder="sk-…"
              onChange={(e) => setValues((p) => ({ ...p, apiKey: e.target.value }))}
            />
            <FieldError id={`${formId}-api-key-error`}>{errors.apiKey}</FieldError>
          </Field>
        )}

        {shouldShowThinkingParam ? (
          <Field>
            <FieldLabel htmlFor={`${formId}-thinking`}>{t(locale, 'admin.ai.provider.form.thinkingParam')}</FieldLabel>
            <Input
              id={`${formId}-thinking`}
              appearance="filled"
              className="h-11"
              value={values.thinkingParam}
              placeholder="enable_thinking"
              onChange={(e) => setValues((p) => ({ ...p, thinkingParam: e.target.value }))}
            />
          </Field>
        ) : null}

        <CollapsibleSection
          icon={Globe}
          title={t(locale, 'admin.ai.provider.form.proxy')}
          open={isProxyOpen}
          onToggle={() => setIsProxyOpen((o) => !o)}
        >
          <Input
            id={`${formId}-proxy`}
            appearance="filled"
            className="h-11"
            value={values.proxyUrl}
            placeholder="http://127.0.0.1:7890"
            onChange={(e) => setValues((p) => ({ ...p, proxyUrl: e.target.value }))}
          />
        </CollapsibleSection>

        {shouldShowBalance ? (
          <CollapsibleSection
            icon={Wallet}
            title={t(locale, 'admin.ai.provider.form.balanceQuery')}
            open={isBalanceOpen}
            onToggle={() => setIsBalanceOpen((o) => !o)}
          >
            <Input
              appearance="filled"
              className="h-11 font-mono text-sm"
              value={values.balanceEndpoint}
              placeholder={t(locale, 'admin.ai.provider.form.balanceEndpointPlaceholder')}
              onChange={(e) => setValues((p) => ({ ...p, balanceEndpoint: e.target.value }))}
            />
            <FieldDescription>{t(locale, 'admin.ai.provider.form.balanceEndpointHint')}</FieldDescription>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                appearance="filled"
                className="h-11 font-mono text-sm"
                value={values.balanceAmountPath}
                placeholder={t(locale, 'admin.ai.provider.form.balanceAmountPathPlaceholder')}
                onChange={(e) => setValues((p) => ({ ...p, balanceAmountPath: e.target.value }))}
              />
              <Input
                appearance="filled"
                className="h-11 font-mono text-sm"
                value={values.balanceCurrencyPath}
                placeholder={t(locale, 'admin.ai.provider.form.balanceCurrencyPathPlaceholder')}
                onChange={(e) => setValues((p) => ({ ...p, balanceCurrencyPath: e.target.value }))}
              />
            </div>
          </CollapsibleSection>
        ) : null}
      </FieldGroup>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-11 rounded-[8px] px-6 hover:bg-brand-deep" disabled={pending}>
          {pending
            ? t(locale, 'admin.content.common.saving')
            : isEdit
              ? t(locale, 'admin.ai.provider.form.save')
              : t(locale, 'admin.ai.provider.form.add')}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-[8px] px-6"
            disabled={pending}
            onClick={onCancel}
          >
            {t(locale, 'admin.content.common.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
