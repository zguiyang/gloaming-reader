'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import { type TtsConfigView, type TtsVoicePreset, type TtsVoiceRole } from '@gloaming/shared/tts';

import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SecretField } from '@/components/ui/secret-field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  adminTtsQueryKey,
  formatAdminTtsApiError,
  getTtsConfig,
  listTtsVoicePresets,
  putTtsConfig,
  testTts,
} from '@/features/admin/tts/tts-config-api';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type TestRoleValue = 'default' | TtsVoiceRole;

function voiceSelectItems(list: TtsVoicePreset[], current: string) {
  const items = list.map((preset) => ({ value: preset.voice, label: preset.label }));
  if (current && !items.some((item) => item.value === current)) {
    items.push({ value: current, label: current });
  }
  return items;
}

function TtsConfigForm({ config, presets }: { config: TtsConfigView; presets: TtsVoicePreset[] }) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();

  const [region, setRegion] = useState(config.region);
  const [apiKey, setApiKey] = useState('');
  const [isReplacingKey, setIsReplacingKey] = useState(false);
  const [isEnabled, setIsEnabled] = useState(config.isEnabled);
  const [defaultVoice, setDefaultVoice] = useState(config.defaultVoice);
  const [usVoice, setUsVoice] = useState(config.usVoice);
  const [ukVoice, setUkVoice] = useState(config.ukVoice);

  const [testText, setTestText] = useState('hello');
  const [testRole, setTestRole] = useState<TestRoleValue>('default');
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  const usPresets = useMemo(() => presets.filter((item) => item.role === 'us'), [presets]);
  const ukPresets = useMemo(() => presets.filter((item) => item.role === 'uk'), [presets]);
  const allPresets = useMemo(() => [...usPresets, ...ukPresets], [usPresets, ukPresets]);

  const defaultVoiceItems = useMemo(() => voiceSelectItems(allPresets, defaultVoice), [allPresets, defaultVoice]);
  const usVoiceItems = useMemo(() => voiceSelectItems(usPresets, usVoice), [usPresets, usVoice]);
  const ukVoiceItems = useMemo(() => voiceSelectItems(ukPresets, ukVoice), [ukPresets, ukVoice]);

  const testRoleItems = useMemo(
    () => [
      { value: 'default' as const, label: t(locale, 'admin.tts.test.roleDefaultVoice') },
      { value: 'us' as const, label: t(locale, 'admin.logs.enum.ttsRole.us') },
      { value: 'uk' as const, label: t(locale, 'admin.logs.enum.ttsRole.uk') },
    ],
    [locale],
  );

  const hasUnsavedChanges =
    apiKey.trim().length > 0 ||
    region !== config.region ||
    isEnabled !== config.isEnabled ||
    defaultVoice !== config.defaultVoice ||
    usVoice !== config.usVoice ||
    ukVoice !== config.ukVoice;

  function resetDraft() {
    setRegion(config.region);
    setApiKey('');
    setIsReplacingKey(false);
    setIsEnabled(config.isEnabled);
    setDefaultVoice(config.defaultVoice);
    setUsVoice(config.usVoice);
    setUkVoice(config.ukVoice);
  }

  function playAudioBase64(mimeType: string, audioBase64: string) {
    const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
    void audio.play().catch(() => {
      toast.error(t(locale, 'admin.tts.audioPlayFailed'));
    });
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      putTtsConfig({
        region: region.trim(),
        isEnabled,
        defaultVoice: defaultVoice.trim(),
        usVoice: usVoice.trim(),
        ukVoice: ukVoice.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminTtsQueryKey.config() });
      setApiKey('');
      setIsReplacingKey(false);
      toast.success(t(locale, 'admin.tts.toast.saved'));
    },
    onError: (error) => {
      toast.error(formatAdminTtsApiError(error));
    },
  });

  const testMutation = useMutation({
    mutationFn: () =>
      testTts({
        text: testText.trim(),
        ...(testRole === 'default' ? {} : { role: testRole }),
      }),
    onSuccess: (result) => {
      setLastLatencyMs(result.latencyMs);
      playAudioBase64(result.mimeType, result.audioBase64);
      toast.success(
        t(locale, 'admin.tts.toast.testSuccess', {
          voice: result.voice,
          latencyMs: result.latencyMs,
        }),
      );
    },
    onError: (error) => {
      setLastLatencyMs(null);
      toast.error(formatAdminTtsApiError(error));
    },
  });

  return (
    <div className="flex w-full max-w-[680px] flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
          {t(locale, 'admin.tts.title')}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">{t(locale, 'admin.tts.subtitle')}</p>
      </header>

      <section className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-foreground">{t(locale, 'admin.tts.service.title')}</h2>
            <p className="text-sm text-muted-foreground">
              {config.configured
                ? t(locale, 'admin.tts.service.configured', { masked: config.apiKeyMasked ?? '****' })
                : t(locale, 'admin.tts.service.notConfigured')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t(locale, 'admin.tts.service.saveWithConfig')}</span>
            <Switch
              checked={isEnabled}
              onCheckedChange={setIsEnabled}
              aria-label={t(locale, 'admin.tts.service.enableAria')}
            />
          </div>
        </div>

        <FieldGroup className="gap-6">
          <Field>
            <FieldLabel htmlFor="tts-region">{t(locale, 'admin.tts.fields.region')}</FieldLabel>
            <Input
              id="tts-region"
              appearance="filled"
              className="h-11"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="eastasia"
              autoComplete="off"
            />
          </Field>

          <SecretField
            id="tts-api-key"
            label={t(locale, 'admin.tts.fields.subscriptionKey')}
            isSet={config.apiKeySet}
            masked={config.apiKeyMasked}
            value={apiKey}
            onChange={setApiKey}
            disabled={saveMutation.isPending}
            replacing={isReplacingKey}
            onReplace={() => setIsReplacingKey(true)}
            onCancelReplace={() => {
              setApiKey('');
              setIsReplacingKey(false);
            }}
            placeholderWhenSet={t(locale, 'admin.tts.fields.apiKeyPlaceholderKeep')}
            copy={{
              replaceLabel: t(locale, 'common.secret.newKey'),
              replaceAction: t(locale, 'common.secret.replace'),
              cancelReplaceAction: t(locale, 'common.secret.cancelReplace'),
              keepHint: t(locale, 'common.secret.keepHint'),
              configuredLabel: t(locale, 'common.secret.configured'),
            }}
          />

          <div className="flex flex-col gap-5">
            <Field>
              <FieldLabel htmlFor="tts-default-voice">{t(locale, 'admin.tts.fields.defaultVoice')}</FieldLabel>
              <Select
                items={defaultVoiceItems}
                value={defaultVoice}
                onValueChange={(value) => value && setDefaultVoice(value)}
              >
                <SelectTrigger id="tts-default-voice" appearance="filled" className="h-11 w-full">
                  <SelectValue placeholder={t(locale, 'admin.tts.fields.defaultVoicePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {defaultVoiceItems.map((item) => (
                      <SelectItem key={`default-${item.value}`} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <div className="flex flex-col gap-5">
              <Field>
                <FieldLabel htmlFor="tts-us-voice">{t(locale, 'admin.tts.fields.usVoice')}</FieldLabel>
                <Select items={usVoiceItems} value={usVoice} onValueChange={(value) => value && setUsVoice(value)}>
                  <SelectTrigger id="tts-us-voice" appearance="filled" className="h-11 w-full">
                    <SelectValue placeholder={t(locale, 'admin.tts.fields.usVoicePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {usVoiceItems.map((item) => (
                        <SelectItem key={`us-${item.value}`} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="tts-uk-voice">{t(locale, 'admin.tts.fields.ukVoice')}</FieldLabel>
                <Select items={ukVoiceItems} value={ukVoice} onValueChange={(value) => value && setUkVoice(value)}>
                  <SelectTrigger id="tts-uk-voice" appearance="filled" className="h-11 w-full">
                    <SelectValue placeholder={t(locale, 'admin.tts.fields.ukVoicePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {ukVoiceItems.map((item) => (
                        <SelectItem key={`uk-${item.value}`} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
        </FieldGroup>

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-[8px] px-6"
            disabled={saveMutation.isPending}
            onClick={resetDraft}
          >
            {t(locale, 'admin.content.common.cancelChanges')}
          </Button>
          <Button
            type="button"
            className="h-11 rounded-[8px] px-6 hover:bg-brand-deep"
            disabled={saveMutation.isPending || !region.trim()}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? t(locale, 'admin.content.common.saving') : t(locale, 'admin.tts.saveConfig')}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        {/* Stable feedback cell: both clean and dirty lines are always mounted in the same grid
            area, so the row reserves the max of their actual wrapped heights (zh/en, 390px or
            desktop). The inactive line is invisible + aria-hidden with no role; only the active
            paragraph carries role=status. Test fields below never shift across clean/dirty/cancel. */}
        <div className="grid gap-1 border-b border-border/60 pb-3">
          <h2 className="col-start-1 row-start-1 text-base font-semibold text-foreground">
            {t(locale, 'admin.tts.test.sectionTitle')}
          </h2>
          <p
            role={hasUnsavedChanges ? undefined : 'status'}
            aria-hidden={hasUnsavedChanges ? true : undefined}
            className={cn('col-start-1 row-start-2 text-sm text-muted-foreground', hasUnsavedChanges && 'invisible')}
          >
            {t(locale, 'admin.tts.test.sectionDescription')}
          </p>
          <p
            role={hasUnsavedChanges ? 'status' : undefined}
            aria-hidden={hasUnsavedChanges ? undefined : true}
            className={cn(
              'col-start-1 row-start-2 text-sm text-muted-foreground',
              hasUnsavedChanges ? undefined : 'invisible',
            )}
          >
            {t(locale, 'admin.tts.test.draftNotice')}
          </p>
        </div>

        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel htmlFor="tts-test-text">{t(locale, 'admin.tts.test.testText')}</FieldLabel>
            <Input
              id="tts-test-text"
              appearance="filled"
              className="h-11"
              value={testText}
              onChange={(event) => setTestText(event.target.value)}
              placeholder="hello"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="tts-test-role">{t(locale, 'admin.tts.test.role')}</FieldLabel>
            <Select
              items={testRoleItems}
              value={testRole}
              onValueChange={(value) => {
                if (value === 'default' || value === 'us' || value === 'uk') {
                  setTestRole(value);
                }
              }}
            >
              <SelectTrigger id="tts-test-role" appearance="filled" className="h-11 w-full">
                <SelectValue placeholder={t(locale, 'admin.tts.test.rolePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {testRoleItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>

        <div className="flex flex-wrap items-center justify-end gap-4">
          {lastLatencyMs != null ? (
            <p className="text-sm tabular-nums text-muted-foreground">
              {t(locale, 'admin.tts.test.lastLatency', { latencyMs: lastLatencyMs })}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-[8px] px-6"
            disabled={testMutation.isPending || !testText.trim() || !config.configured}
            onClick={() => testMutation.mutate()}
          >
            {testMutation.isPending ? t(locale, 'admin.tts.test.running') : t(locale, 'admin.tts.test.run')}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function TtsConfigPage() {
  const { locale } = useLocale();
  const configQuery = useQuery({
    queryKey: adminTtsQueryKey.config(),
    queryFn: ({ signal }) => getTtsConfig({ signal }),
  });
  const presetsQuery = useQuery({
    queryKey: adminTtsQueryKey.presets(),
    queryFn: ({ signal }) => listTtsVoicePresets({ signal }),
  });

  const isPending = configQuery.isPending || presetsQuery.isPending;
  const loadError = configQuery.error ?? presetsQuery.error;
  const config = configQuery.data;
  const presets = presetsQuery.data;

  if (isPending) {
    return (
      <div className="flex w-full max-w-[680px] flex-col gap-6">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (loadError || !config || !presets) {
    return (
      <div className="w-full max-w-[680px]">
        <p className="rounded-xl border border-border bg-secondary/60 px-5 py-8 text-sm text-destructive">
          {formatAdminTtsApiError(loadError ?? new Error(t(locale, 'admin.tts.loadFailed')))}
        </p>
      </div>
    );
  }

  const formKey = `${config.updatedAt ?? 'new'}:${config.defaultVoice}:${config.usVoice}:${config.ukVoice}:${config.region}:${config.isEnabled}`;

  return <TtsConfigForm key={formKey} config={config} presets={presets} />;
}
