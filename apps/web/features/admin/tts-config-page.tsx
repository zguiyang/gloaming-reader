'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { type TtsConfigView, type TtsVoicePreset, type TtsVoiceRole } from '@gloaming/shared/tts';

import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
} from '@/features/admin/tts-config-api';

type TestRoleValue = 'default' | TtsVoiceRole;

function voiceSelectItems(list: TtsVoicePreset[], current: string) {
  const items = list.map((preset) => ({ value: preset.voice, label: preset.label }));
  if (current && !items.some((item) => item.value === current)) {
    items.push({ value: current, label: current });
  }
  return items;
}

const TEST_ROLE_ITEMS = [
  { value: 'default', label: '默认音色' },
  { value: 'us', label: '美音' },
  { value: 'uk', label: '英音' },
] as const;

function playAudioBase64(mimeType: string, audioBase64: string) {
  const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
  void audio.play().catch(() => {
    toast.error('音频播放失败，请检查浏览器权限');
  });
}

function TtsConfigForm({ config, presets }: { config: TtsConfigView; presets: TtsVoicePreset[] }) {
  const queryClient = useQueryClient();

  const [region, setRegion] = useState(config.region);
  const [apiKey, setApiKey] = useState('');
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
      toast.success('已保存语音配置');
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
      toast.success(`连通成功 · ${result.voice} · ${result.latencyMs} ms`);
    },
    onError: (error) => {
      setLastLatencyMs(null);
      toast.error(formatAdminTtsApiError(error));
    },
  });

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto flex w-full max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">语音配置</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Azure Speech 凭证与默认音色；密钥加密存储，页面只展示脱敏信息。
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card px-6 py-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-medium text-foreground">服务配置</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {config.configured
                ? `已配置 · Key ${config.apiKeyMasked ?? '****'}`
                : '尚未配置，首次保存需填写 Subscription Key'}
            </p>
          </div>
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} aria-label="启用语音服务" />
        </div>

        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel htmlFor="tts-region">Region</FieldLabel>
            <Input
              id="tts-region"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="eastasia"
              autoComplete="off"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="tts-api-key">Subscription Key</FieldLabel>
            <Input
              id="tts-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={config.apiKeySet ? '留空则保留现有密钥' : '必填'}
              autoComplete="new-password"
            />
          </Field>

          <Field>
            <FieldLabel>默认音色</FieldLabel>
            <Select
              items={defaultVoiceItems}
              value={defaultVoice}
              onValueChange={(value) => value && setDefaultVoice(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择默认音色" />
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

          <div className="grid gap-5 md:grid-cols-2">
            <Field>
              <FieldLabel>美音音色</FieldLabel>
              <Select items={usVoiceItems} value={usVoice} onValueChange={(value) => value && setUsVoice(value)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择美音" />
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
              <FieldLabel>英音音色</FieldLabel>
              <Select items={ukVoiceItems} value={ukVoice} onValueChange={(value) => value && setUkVoice(value)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择英音" />
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
        </FieldGroup>

        <div className="mt-6 flex justify-end">
          <Button
            type="button"
            className="h-10 rounded-xl px-6 hover:bg-brand-deep"
            disabled={saveMutation.isPending || !region.trim()}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? '保存中…' : '保存配置'}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card px-6 py-6">
        <h2 className="mb-6 text-base font-medium text-foreground">连通性测试</h2>

        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel htmlFor="tts-test-text">测试文本</FieldLabel>
            <Input
              id="tts-test-text"
              value={testText}
              onChange={(event) => setTestText(event.target.value)}
              placeholder="hello"
            />
          </Field>

          <Field>
            <FieldLabel>角色</FieldLabel>
            <Select
              items={[...TEST_ROLE_ITEMS]}
              value={testRole}
              onValueChange={(value) => {
                if (value === 'default' || value === 'us' || value === 'uk') {
                  setTestRole(value);
                }
              }}
            >
              <SelectTrigger className="w-full md:w-56">
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {TEST_ROLE_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            disabled={testMutation.isPending || !testText.trim() || !config.configured}
            onClick={() => testMutation.mutate()}
          >
            {testMutation.isPending ? '测试中…' : '测试连通'}
          </Button>
          {lastLatencyMs != null ? (
            <p className="text-sm tabular-nums text-muted-foreground">最近耗时 {lastLatencyMs} ms</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function TtsConfigPage() {
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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Skeleton className="h-10 w-48 rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (loadError || !config || !presets) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <p className="rounded-2xl border border-border bg-secondary/60 px-5 py-8 text-sm text-destructive md:px-6">
          {formatAdminTtsApiError(loadError ?? new Error('配置加载失败'))}
        </p>
      </div>
    );
  }

  const formKey = `${config.updatedAt ?? 'new'}:${config.defaultVoice}:${config.usVoice}:${config.ukVoice}:${config.region}:${config.isEnabled}`;

  return <TtsConfigForm key={formKey} config={config} presets={presets} />;
}
