'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Volume2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  DICTIONARY_PROVIDER_CUSTOM,
  DICTIONARY_PROVIDER_FREE,
  DICTIONARY_PROVIDER_YOUDAO,
  type DictionaryConfigView,
  type TestDictionaryResult,
} from '@gloaming/shared/dictionary';

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

const PROVIDER_OPTIONS = [
  { value: DICTIONARY_PROVIDER_YOUDAO, label: '有道词典开放接口（中文释义 + 英美发音 · 国内极速推荐）' },
  { value: DICTIONARY_PROVIDER_FREE, label: 'Free Dictionary API（英文骨架 · 海外直连/需代理）' },
  { value: DICTIONARY_PROVIDER_CUSTOM, label: '自定义 REST 兼容接口' },
];

function playAudioUrl(url: string) {
  const audio = new Audio(url);
  void audio.play().catch(() => {
    toast.error('音频播放失败，请检查浏览器权限或音频链接是否有效');
  });
}

function DictionaryConfigForm({ config }: { config: DictionaryConfigView }) {
  const queryClient = useQueryClient();

  const [provider, setProvider] = useState(config.provider || DICTIONARY_PROVIDER_FREE);
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
      toast.success('已保存词典配置');
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
      toast.success(`查词成功 · ${result.entry.word} · ${result.latencyMs} ms`);
    },
    onError: (error) => {
      setTestResult(null);
      toast.error(formatAdminDictionaryApiError(error));
    },
  });

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto flex w-full max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">词典配置</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          可插拔词典服务商与 AI 语境例句增强；支持 Redis/DB 多级缓存与实时连通性测试。
        </p>
      </header>

      {/* 核心服务配置 */}
      <section className="rounded-2xl border border-border bg-card px-6 py-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-medium text-foreground">服务基础设置</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {config.configured ? '已配置持久化设置' : '使用系统内置默认配置'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{isEnabled ? '已启用' : '已停用'}</span>
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} aria-label="启用词典服务" />
          </div>
        </div>

        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel>服务提供商 (Provider)</FieldLabel>
            <Select items={PROVIDER_OPTIONS} value={provider} onValueChange={(val) => val && setProvider(val)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择词典服务商" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {PROVIDER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-surface-container-lowest p-4">
            <div className="space-y-1">
              <span className="text-sm font-medium text-foreground">AI 语境与例句智能增强</span>
              <p className="text-xs text-muted-foreground">
                查词时结合读者当前阅读作品章节，由 AI 自动回填精准中文释义、原著上下文例句及助读微注。
              </p>
            </div>
            <Switch
              checked={enableAiEnrichment}
              onCheckedChange={setEnableAiEnrichment}
              aria-label="启用 AI 语境增强"
            />
          </div>

          <Field>
            <FieldLabel htmlFor="dict-endpoint">自定义 API Endpoint (可选)</FieldLabel>
            <Input
              id="dict-endpoint"
              value={customEndpoint}
              onChange={(e) => setCustomEndpoint(e.target.value)}
              placeholder="默认使用官方公共接口，如需反代或私有部署可在此填写"
              autoComplete="off"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="dict-api-key">API 鉴权密钥 (可选)</FieldLabel>
            <Input
              id="dict-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config.apiKeySet ? `已设置密钥 (${config.apiKeyMasked ?? '****'})，留空保留` : '选填'}
              autoComplete="new-password"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="dict-timeout">请求超时时间 (毫秒)</FieldLabel>
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
              <FieldLabel htmlFor="dict-ttl">词条缓存天数 (Redis & DB)</FieldLabel>
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
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? '保存中...' : '保存配置'}
            </Button>
          </div>
        </FieldGroup>
      </section>

      {/* 连通性测试区 */}
      <section className="rounded-2xl border border-border bg-card px-6 py-6">
        <header className="mb-4">
          <h2 className="text-base font-medium text-foreground">连通性与查词测试</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            验证词典 Provider 接口连通性、音标与音频解析，以及 AI 中文释义回填流水线。
          </p>
        </header>

        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="test-word">测试单词</FieldLabel>
            <Input
              id="test-word"
              value={testWord}
              onChange={(e) => setTestWord(e.target.value)}
              placeholder="输入英文单词，如 serendipity"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="test-sentence">模拟语境句子 (选填)</FieldLabel>
            <Textarea
              id="test-sentence"
              value={testContextSentence}
              onChange={(e) => setTestContextSentence(e.target.value)}
              rows={2}
              placeholder="输入包含该词的例句，用于测试 AI 语境理解与微注"
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
              {testMutation.isPending ? '查询测试中...' : '测试查词'}
            </Button>
          </div>

          {testResult ? (
            <div className="mt-6 rounded-xl border border-border/80 bg-surface-container-lowest p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
                <div className="flex items-center gap-3">
                  <span className="font-heading text-xl font-bold text-foreground">{testResult.entry.word}</span>
                  <Badge variant="secondary" className="text-xs">
                    {testResult.provider}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  耗时: <strong className="text-foreground">{testResult.latencyMs} ms</strong>
                </span>
              </div>

              {/* Phonetics & Audio */}
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
                      <span className="font-mono">{p.text || 'IPA'}</span>
                      {p.audio ? (
                        <button
                          type="button"
                          onClick={() => playAudioUrl(p.audio!)}
                          className="text-primary hover:text-brand-deep cursor-pointer"
                          title="播放读音"
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Meanings */}
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

              {/* Context Examples */}
              {testResult.entry.contextExamples && testResult.entry.contextExamples.length > 0 ? (
                <div className="rounded-lg border-l-2 border-primary/60 bg-surface-container-high/40 p-3 space-y-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">语境例句与助读微注：</span>
                  {testResult.entry.contextExamples.map((ex, exIdx) => (
                    <div key={exIdx} className="text-xs space-y-1">
                      <p className="italic text-foreground">{ex.sentence}</p>
                      {ex.sentenceZh ? <p className="text-muted-foreground">{ex.sentenceZh}</p> : null}
                      {ex.note ? <p className="text-primary/90 font-medium">💡 助读微注: {ex.note}</p> : null}
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
