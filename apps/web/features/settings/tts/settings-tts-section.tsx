'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import { DEFAULT_TTS_VOICES, TTS_VOICE_PRESETS, type TtsConfigView } from '@gloaming/shared/tts';

import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { formatUserSettingsApiError, putUserTtsConfig, userSettingsQueryKey } from '@/features/settings/settings-api';
import { useLocale } from '@/lib/locale-context';

export function SettingsTtsSection({ config }: { config: TtsConfigView }) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [region, setRegion] = useState(config.region);
  const [apiKey, setApiKey] = useState('');
  const [defaultVoice, setDefaultVoice] = useState(config.defaultVoice || DEFAULT_TTS_VOICES.defaultVoice);
  const [usVoice, setUsVoice] = useState(config.usVoice || DEFAULT_TTS_VOICES.usVoice);
  const [ukVoice, setUkVoice] = useState(config.ukVoice || DEFAULT_TTS_VOICES.ukVoice);
  const [enabled, setEnabled] = useState(config.configured ? config.isEnabled : false);
  const [regionError, setRegionError] = useState('');

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!region.trim()) throw new Error(t(locale, 'settings.validation.required'));
      if (!config.apiKeySet && !apiKey.trim()) throw new Error(t(locale, 'settings.validation.required'));
      return putUserTtsConfig({
        region: region.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        isEnabled: enabled,
        defaultVoice,
        usVoice,
        ukVoice,
      });
    },
    onSuccess: async (next) => {
      queryClient.setQueryData(userSettingsQueryKey.tts(), next);
      await queryClient.invalidateQueries({ queryKey: userSettingsQueryKey.tts() });
      setApiKey('');
      toast.success(t(locale, 'settings.saved'));
    },
    onError: (error) => toast.error(formatUserSettingsApiError(error)),
  });

  function chooseDefault() {
    if (!config.configured || !config.isEnabled) return;
    setEnabled(false);
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="font-heading text-xl font-semibold">{t(locale, 'settings.tts.title')}</h2>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t(locale, 'settings.serviceMode')}>
          <Button
            type="button"
            variant={!config.configured || !enabled ? 'default' : 'outline'}
            onClick={chooseDefault}
          >
            {t(locale, 'settings.defaultService')}
          </Button>
          <Button
            type="button"
            variant={config.configured && enabled ? 'default' : 'outline'}
            onClick={() => setEnabled(true)}
          >
            {t(locale, 'settings.ownApi')}
          </Button>
        </div>
      </div>
      {!enabled ? (
        <p className="text-sm text-muted-foreground">{t(locale, 'settings.tts.defaultDescription')}</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!region.trim()) {
              setRegionError(t(locale, 'settings.validation.required'));
              return;
            }
            setRegionError('');
            saveMutation.mutate();
          }}
        >
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(regionError) || undefined}>
                <FieldLabel htmlFor="settings-tts-region">{t(locale, 'settings.tts.region')}</FieldLabel>
                <Input id="settings-tts-region" value={region} onChange={(e) => setRegion(e.target.value)} />
                <FieldError>{regionError}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-tts-key">
                  {t(locale, 'settings.ai.apiKey')}
                  {config.apiKeySet ? ` · ${config.apiKeyMasked ?? t(locale, 'settings.secret.saved')}` : ''}
                </FieldLabel>
                <Input
                  id="settings-tts-key"
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  placeholder={config.apiKeySet ? t(locale, 'settings.secret.leaveBlank') : ''}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ['default', defaultVoice, setDefaultVoice],
                  ['us', usVoice, setUsVoice],
                  ['uk', ukVoice, setUkVoice],
                ] as const
              ).map(([key, value, setter]) => (
                <Field key={key}>
                  <FieldLabel htmlFor={`settings-tts-${key}`}>{t(locale, `settings.tts.voice.${key}`)}</FieldLabel>
                  <select
                    id={`settings-tts-${key}`}
                    className="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={value}
                    onChange={(event) => setter(event.target.value)}
                  >
                    {TTS_VOICE_PRESETS.filter((preset) => key === 'default' || preset.role === key).map((preset) => (
                      <option key={preset.voice} value={preset.voice}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </FieldGroup>
          <div>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t(locale, 'settings.saving') : t(locale, 'settings.save')}
            </Button>
          </div>
        </form>
      )}
      {config.configured && !enabled ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">{t(locale, 'settings.tts.defaultDescription')}</p>
          <Button
            type="button"
            variant="outline"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {t(locale, 'settings.save')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
