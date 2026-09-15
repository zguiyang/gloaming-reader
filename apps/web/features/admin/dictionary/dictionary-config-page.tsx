'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert, Volume2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { type Locale, t } from '@gloaming/i18n';
import {
  DICTIONARY_PROVIDER_CUSTOM,
  DICTIONARY_PROVIDER_FREE,
  DICTIONARY_PROVIDER_YOUDAO,
  type DictionaryConfigView,
  type TestDictionaryResult,
} from '@gloaming/shared/dictionary';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  adminDictionaryQueryKey,
  formatAdminDictionaryApiError,
  getDictionaryConfig,
  putDictionaryConfig,
  testDictionary,
} from '@/features/admin/dictionary/dictionary-config-api';
import { useLocale } from '@/lib/locale-context';

type ProviderSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

function supportedProviderOptions(locale: Locale): ProviderSelectOption[] {
  return [
    { value: DICTIONARY_PROVIDER_YOUDAO, label: t(locale, 'admin.dictionary.provider.youdao') },
    { value: DICTIONARY_PROVIDER_FREE, label: t(locale, 'admin.dictionary.provider.free') },
  ];
}

const SUPPORTED_PROVIDER_VALUES = new Set<string>([DICTIONARY_PROVIDER_YOUDAO, DICTIONARY_PROVIDER_FREE]);

function providerDisplayName(id: string, locale: Locale): string {
  switch (id) {
    case DICTIONARY_PROVIDER_YOUDAO:
      return t(locale, 'admin.dictionary.provider.displayYoudao');
    case DICTIONARY_PROVIDER_FREE:
      return t(locale, 'admin.dictionary.provider.displayFree');
    case DICTIONARY_PROVIDER_CUSTOM:
      return t(locale, 'admin.dictionary.provider.displayCustom');
    default:
      return id
        ? t(locale, 'admin.dictionary.provider.displayUnknown', { id })
        : t(locale, 'admin.dictionary.provider.displayUnknownPlain');
  }
}

function legacyUnsupportedProviderOption(providerId: string, locale: Locale): ProviderSelectOption {
  if (providerId === DICTIONARY_PROVIDER_CUSTOM) {
    return {
      value: DICTIONARY_PROVIDER_CUSTOM,
      label: t(locale, 'admin.dictionary.provider.customLegacy'),
      disabled: true,
    };
  }
  return {
    value: providerId,
    label: t(locale, 'admin.dictionary.provider.unknownLegacy', { id: providerId }),
    disabled: true,
  };
}

/** Actual entry source present and different from configured provider → fallback. */
function isDictionaryTestFallback(result: TestDictionaryResult): boolean {
  const actual = result.entry.source?.trim() ?? '';
  return actual.length > 0 && actual !== result.provider;
}

function DictionaryConfigForm({ config }: { config: DictionaryConfigView }) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();

  const [provider, setProvider] = useState(config.provider || DICTIONARY_PROVIDER_YOUDAO);
  const [isEnabled, setIsEnabled] = useState(config.isEnabled);
  const [enableAiEnrichment, setEnableAiEnrichment] = useState(config.enableAiEnrichment);
  const [customEndpoint, setCustomEndpoint] = useState(config.customEndpoint || '');
  const [apiKey, setApiKey] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(config.timeoutMs || 5000);
  const [cacheTtlDays, setCacheTtlDays] = useState(config.cacheTtlDays || 30);

  const [testWord, setTestWord] = useState('serendipity');
  const [testContextSentence, setTestContextSentence] = useState(
    'Finding this cozy bookshop on a rainy evening was pure serendipity.',
  );
  const [testResult, setTestResult] = useState<TestDictionaryResult | null>(null);

  const isSupportedProvider = SUPPORTED_PROVIDER_VALUES.has(provider);
  const providerSelectOptions: ProviderSelectOption[] = useMemo(() => {
    const options = supportedProviderOptions(locale);
    return isSupportedProvider ? options : [...options, legacyUnsupportedProviderOption(provider, locale)];
  }, [locale, isSupportedProvider, provider]);

  function playAudioUrl(url: string) {
    const audio = new Audio(url);
    void audio.play().catch(() => {
      toast.error(t(locale, 'admin.dictionary.audioPlayFailed'));
    });
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      putDictionaryConfig({
        provider: provider.trim(),
        isEnabled,
        enableAiEnrichment,
        customEndpoint: customEndpoint.trim() || null,
        timeoutMs: Number(timeoutMs) || 5000,
        cacheTtlDays: Number(cacheTtlDays) || 30,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminDictionaryQueryKey.config() });
      setApiKey('');
      toast.success(t(locale, 'admin.dictionary.toast.saved'));
    },
    onError: (error) => {
      toast.error(formatAdminDictionaryApiError(error));
    },
  });

  const testMutation = useMutation({
    mutationFn: () =>
      testDictionary({
        word: testWord.trim(),
        contextSentence: testContextSentence.trim() || undefined,
      }),
    onSuccess: (result) => {
      setTestResult(result);
      if (isDictionaryTestFallback(result)) {
        toast.warning(
          t(locale, 'admin.dictionary.toast.testSuccessFallback', {
            word: result.entry.word,
            latencyMs: result.latencyMs,
            source: providerDisplayName(result.entry.source?.trim() ?? '', locale),
          }),
        );
      } else {
        toast.success(
          t(locale, 'admin.dictionary.toast.testSuccess', {
            word: result.entry.word,
            latencyMs: result.latencyMs,
          }),
        );
      }
    },
    onError: (error) => {
      setTestResult(null);
      toast.error(formatAdminDictionaryApiError(error));
    },
  });

  const testConfiguredProvider = testResult?.provider ?? '';
  const testActualSource = testResult?.entry.source?.trim() ?? '';
  const hasTestUsedFallback =
    testResult != null && testActualSource.length > 0 && testActualSource !== testConfiguredProvider;
  const isTestSourceUnknown = testResult != null && testActualSource.length === 0;

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto flex w-full max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
          {t(locale, 'admin.dictionary.title')}
        </h1>
      </header>

      <section className="rounded-2xl border border-border bg-card px-6 py-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-medium text-foreground">{t(locale, 'admin.dictionary.service.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {config.configured
                ? t(locale, 'admin.dictionary.service.configured')
                : t(locale, 'admin.dictionary.service.notConfigured')}
            </p>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={setIsEnabled}
            aria-label={t(locale, 'admin.dictionary.service.enableAria')}
          />
        </div>

        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel>{t(locale, 'admin.dictionary.provider.label')}</FieldLabel>
            <Select
              items={providerSelectOptions}
              value={provider}
              onValueChange={(val) => {
                if (val && SUPPORTED_PROVIDER_VALUES.has(val)) {
                  setProvider(val);
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t(locale, 'admin.dictionary.provider.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {providerSelectOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} disabled={Boolean(opt.disabled)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {!isSupportedProvider ? (
              <p className="mt-2 text-sm text-destructive">
                {t(locale, 'admin.dictionary.provider.unsupportedHint', { id: provider })}
              </p>
            ) : null}
          </Field>

          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-surface-container-lowest p-4">
            <div className="space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t(locale, 'admin.dictionary.aiEnrichment.title')}
              </span>
              <p className="text-xs text-muted-foreground">{t(locale, 'admin.dictionary.aiEnrichment.description')}</p>
            </div>
            <Switch
              checked={enableAiEnrichment}
              onCheckedChange={setEnableAiEnrichment}
              aria-label={t(locale, 'admin.dictionary.aiEnrichment.enableAria')}
            />
          </div>

          <Field>
            <FieldLabel htmlFor="dict-endpoint">{t(locale, 'admin.dictionary.fields.customEndpoint')}</FieldLabel>
            <Input
              id="dict-endpoint"
              value={customEndpoint}
              onChange={(e) => setCustomEndpoint(e.target.value)}
              placeholder={t(locale, 'admin.dictionary.fields.customEndpointPlaceholder')}
              autoComplete="off"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="dict-api-key">{t(locale, 'admin.dictionary.fields.apiKey')}</FieldLabel>
            <Input
              id="dict-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                config.apiKeySet
                  ? t(locale, 'admin.dictionary.fields.apiKeyPlaceholderKeep', {
                      masked: config.apiKeyMasked ?? '****',
                    })
                  : t(locale, 'admin.dictionary.fields.apiKeyPlaceholderOptional')
              }
              autoComplete="new-password"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="dict-timeout">{t(locale, 'admin.dictionary.fields.timeoutMs')}</FieldLabel>
              <Input
                id="dict-timeout"
                type="number"
                min={1000}
                max={60000}
                step={500}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value))}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="dict-ttl">{t(locale, 'admin.dictionary.fields.cacheTtlDays')}</FieldLabel>
              <Input
                id="dict-ttl"
                type="number"
                min={1}
                max={365}
                value={cacheTtlDays}
                onChange={(e) => setCacheTtlDays(Number(e.target.value))}
              />
            </Field>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              className="rounded-full px-6"
              disabled={saveMutation.isPending || !isSupportedProvider}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? t(locale, 'admin.dictionary.saving') : t(locale, 'admin.dictionary.saveConfig')}
            </Button>
          </div>
        </FieldGroup>
      </section>

      <section className="rounded-2xl border border-border bg-card px-6 py-6">
        <header className="mb-4">
          <h2 className="text-base font-medium text-foreground">{t(locale, 'admin.dictionary.test.sectionTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(locale, 'admin.dictionary.test.sectionDescription')}</p>
        </header>

        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="test-word">{t(locale, 'admin.dictionary.test.word')}</FieldLabel>
            <Input
              id="test-word"
              value={testWord}
              onChange={(e) => setTestWord(e.target.value)}
              placeholder={t(locale, 'admin.dictionary.test.wordPlaceholder')}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="test-sentence">{t(locale, 'admin.dictionary.test.contextSentence')}</FieldLabel>
            <Textarea
              id="test-sentence"
              value={testContextSentence}
              onChange={(e) => setTestContextSentence(e.target.value)}
              rows={2}
              placeholder={t(locale, 'admin.dictionary.test.contextPlaceholder')}
            />
          </Field>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="secondary"
              className="rounded-full px-5"
              disabled={testMutation.isPending || !testWord.trim()}
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending
                ? t(locale, 'admin.dictionary.test.running')
                : t(locale, 'admin.dictionary.test.run')}
            </Button>
          </div>

          {testResult ? (
            <div className="mt-6 rounded-xl border border-border/80 bg-surface-container-lowest p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-heading text-xl font-bold text-foreground">{testResult.entry.word}</span>
                  <Badge variant="secondary" className="text-xs">
                    {providerDisplayName(testConfiguredProvider, locale)}
                  </Badge>
                  {isTestSourceUnknown ? (
                    <span className="text-xs text-muted-foreground">
                      {t(locale, 'admin.dictionary.test.sourceUnknown')}
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">
                  {t(locale, 'admin.dictionary.test.latency')}{' '}
                  <strong className="text-foreground">{testResult.latencyMs} ms</strong>
                </span>
              </div>

              {hasTestUsedFallback ? (
                <Alert className="border-amber-500/40 bg-amber-500/5 text-foreground">
                  <TriangleAlert className="text-amber-600 dark:text-amber-400" />
                  <AlertDescription className="text-foreground/90">
                    {t(locale, 'admin.dictionary.test.fallbackDescription', {
                      source: providerDisplayName(testActualSource, locale),
                    })}
                  </AlertDescription>
                </Alert>
              ) : null}

              {testResult.entry.phonetics.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {testResult.entry.phonetics.map((p, idx) => (
                    <div
                      key={idx}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface-container px-3 py-1 text-xs text-foreground"
                    >
                      {p.role ? (
                        <span className="uppercase text-[10px] text-muted-foreground font-semibold">{p.role}:</span>
                      ) : null}
                      <span className="font-mono">{p.text || t(locale, 'admin.dictionary.test.ipaFallback')}</span>
                      {p.audio ? (
                        <button
                          type="button"
                          onClick={() => playAudioUrl(p.audio!)}
                          className="text-primary hover:text-brand-deep cursor-pointer"
                          title={t(locale, 'admin.dictionary.test.playPronunciation')}
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="space-y-3 pt-2">
                {testResult.entry.meanings.map((m, mIdx) => (
                  <div key={mIdx} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-medium text-primary">
                        {m.partOfSpeech}
                      </span>
                    </div>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/90">
                      {m.definitions.map((def, dIdx) => (
                        <li key={dIdx} className="leading-relaxed">
                          <span>{def.definition}</span>
                          {def.definitionZh ? (
                            <span className="ml-2 font-medium text-primary/90">({def.definitionZh})</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {testResult.entry.contextExamples && testResult.entry.contextExamples.length > 0 ? (
                <div className="rounded-lg border-l-2 border-primary/60 bg-surface-container-high/40 p-3 space-y-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {t(locale, 'admin.dictionary.test.contextExamplesHeading')}
                  </span>
                  {testResult.entry.contextExamples.map((ex, exIdx) => (
                    <div key={exIdx} className="text-xs space-y-1">
                      <p className="italic text-foreground">{ex.sentence}</p>
                      {ex.sentenceZh ? <p className="text-muted-foreground">{ex.sentenceZh}</p> : null}
                      {ex.note ? (
                        <p className="text-primary/90 font-medium">
                          {t(locale, 'admin.dictionary.test.readingNote', { note: ex.note })}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function DictionaryConfigPage() {
  const { data, isPending, error } = useQuery({
    queryKey: adminDictionaryQueryKey.config(),
    queryFn: ({ signal }) => getDictionaryConfig({ signal }),
  });

  if (isPending) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
        <header className="flex flex-col gap-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-96" />
        </header>
        <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-4 py-16 text-center">
        <p className="text-sm text-destructive">{formatAdminDictionaryApiError(error)}</p>
      </div>
    );
  }

  return <DictionaryConfigForm config={data} />;
}
