'use client';

import { ChevronDown, Globe, Wallet } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import type { LlmApiFamily, LlmProvider } from '@gloaming/shared/llm';
import { getWireFamilyDefinition, providerSupportsOptionalField } from '@gloaming/shared/llm';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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

export function AiProviderForm({ apiFamily, provider, formId, onSubmit, onCancel }: AiProviderFormProps) {
  const familyDef = getWireFamilyDefinition(apiFamily);
  const isEdit = provider != null;
  const [values, setValues] = useState<ProviderFormValues>(() =>
    provider ? providerValuesFromRow(provider) : emptyProviderValues(apiFamily),
  );
  const [errors, setErrors] = useState<Partial<Record<keyof ProviderFormValues, string>>>({});
  const [isProxyOpen, setIsProxyOpen] = useState(() => Boolean(provider?.proxyUrl));
  const [isBalanceOpen, setIsBalanceOpen] = useState(() =>
    Boolean(provider?.balanceEndpoint || provider?.balanceAmountPath),
  );

  const shouldShowThinkingParam = providerSupportsOptionalField(apiFamily, 'thinkingParam');
  const shouldShowBalance = familyDef.provider.capabilities.balanceQuery;

  function validate(): boolean {
    const next: Partial<Record<keyof ProviderFormValues, string>> = {};
    if (!values.name.trim()) {
      next.name = '请填写服务商名称';
    }
    if (!values.baseUrl.trim()) {
      next.baseUrl = '请填写 Base URL';
    } else {
      try {
        new URL(values.baseUrl.trim());
      } catch {
        next.baseUrl = 'Base URL 格式不正确';
      }
    }
    if (!isEdit && !values.apiKey.trim()) {
      next.apiKey = '新建时需要填写 API Key';
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
          <Badge variant="secondary">{familyDef.label}</Badge>
          {!familyDef.runtimeImplemented ? (
            <Badge variant="outline" className="text-xs font-normal">
              运行时尚未支持
            </Badge>
          ) : null}
        </div>
      ) : null}

      <FieldGroup className="gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field data-invalid={Boolean(errors.name) || undefined}>
            <FieldLabel htmlFor={`${formId}-name`}>名称</FieldLabel>
            <Input
              id={`${formId}-name`}
              value={values.name}
              onChange={(e) => setValues((p) => ({ ...p, name: e.target.value }))}
            />
            <FieldError>{errors.name}</FieldError>
          </Field>
          <Field data-invalid={Boolean(errors.baseUrl) || undefined}>
            <FieldLabel htmlFor={`${formId}-base-url`}>Base URL</FieldLabel>
            <Input
              id={`${formId}-base-url`}
              className="font-mono text-sm"
              value={values.baseUrl}
              placeholder={familyDef.provider.baseUrlPlaceholder}
              onChange={(e) => setValues((p) => ({ ...p, baseUrl: e.target.value }))}
            />
            <FieldError>{errors.baseUrl}</FieldError>
          </Field>
        </div>

        <Field data-invalid={Boolean(errors.apiKey) || undefined}>
          <FieldLabel htmlFor={`${formId}-api-key`}>API Key</FieldLabel>
          <Input
            id={`${formId}-api-key`}
            type="password"
            autoComplete="off"
            value={values.apiKey}
            placeholder={isEdit ? '留空表示不修改' : 'sk-…'}
            onChange={(e) => setValues((p) => ({ ...p, apiKey: e.target.value }))}
          />
          {isEdit && provider?.apiKeyMasked ? (
            <p className="text-xs text-muted-foreground">当前：{provider.apiKeyMasked}</p>
          ) : null}
          <FieldError>{errors.apiKey}</FieldError>
        </Field>

        {shouldShowThinkingParam ? (
          <Field>
            <FieldLabel htmlFor={`${formId}-thinking`}>思考参数名（可选）</FieldLabel>
            <Input
              id={`${formId}-thinking`}
              value={values.thinkingParam}
              placeholder="enable_thinking"
              onChange={(e) => setValues((p) => ({ ...p, thinkingParam: e.target.value }))}
            />
          </Field>
        ) : null}

        <CollapsibleSection icon={Globe} title="代理" open={isProxyOpen} onToggle={() => setIsProxyOpen((o) => !o)}>
          <Input
            id={`${formId}-proxy`}
            value={values.proxyUrl}
            placeholder="http://127.0.0.1:7890"
            onChange={(e) => setValues((p) => ({ ...p, proxyUrl: e.target.value }))}
          />
        </CollapsibleSection>

        {shouldShowBalance ? (
          <CollapsibleSection
            icon={Wallet}
            title="余额查询"
            open={isBalanceOpen}
            onToggle={() => setIsBalanceOpen((o) => !o)}
          >
            <Input
              className="font-mono text-sm"
              value={values.balanceEndpoint}
              placeholder="https://… 或 /user/balance"
              onChange={(e) => setValues((p) => ({ ...p, balanceEndpoint: e.target.value }))}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                className="font-mono text-sm"
                value={values.balanceAmountPath}
                placeholder="balance 或 data.balance"
                onChange={(e) => setValues((p) => ({ ...p, balanceAmountPath: e.target.value }))}
              />
              <Input
                className="font-mono text-sm"
                value={values.balanceCurrencyPath}
                placeholder="currency 或 data.currency"
                onChange={(e) => setValues((p) => ({ ...p, balanceCurrencyPath: e.target.value }))}
              />
            </div>
          </CollapsibleSection>
        ) : null}
      </FieldGroup>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="rounded-xl hover:bg-brand-deep">
          {isEdit ? '保存' : '添加'}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" className="rounded-xl" onClick={onCancel}>
            取消
          </Button>
        ) : null}
      </div>
    </form>
  );
}
