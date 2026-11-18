'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@/i18n';
import { DEFAULT_TTS_VOICES, TTS_VOICE_PRESETS, type UserTtsVoicesView } from '@/shared/tts';

import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatUserSettingsApiError, putUserTtsVoices, userSettingsQueryKey } from '@/features/settings/settings-api';
import { useLocale } from '@/lib/locale-context';
import { ttsVoiceLabel } from '@/lib/tts-voice-label';

export function SettingsTtsVoices({ voices }: { voices: UserTtsVoicesView }) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [defaultVoice, setDefaultVoice] = useState(voices.defaultVoice || DEFAULT_TTS_VOICES.defaultVoice);
  const [usVoice, setUsVoice] = useState(voices.usVoice || DEFAULT_TTS_VOICES.usVoice);
  const [ukVoice, setUkVoice] = useState(voices.ukVoice || DEFAULT_TTS_VOICES.ukVoice);

  const saveMutation = useMutation({
    mutationFn: () => putUserTtsVoices({ defaultVoice, usVoice, ukVoice }),
    onSuccess: async (next) => {
      queryClient.setQueryData(userSettingsQueryKey.tts(), next);
      await queryClient.invalidateQueries({ queryKey: userSettingsQueryKey.tts() });
      toast.success(t(locale, 'settings.saved'));
    },
    onError: (error) => toast.error(formatUserSettingsApiError(error)),
  });

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="font-heading text-xl font-semibold">{t(locale, 'settings.tts.title')}</h2>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          saveMutation.mutate();
        }}
      >
        <FieldGroup className="gap-4">
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
                <Select
                  value={value}
                  items={[
                    ...TTS_VOICE_PRESETS.filter((preset) => key === 'default' || preset.role === key).map((preset) => ({
                      value: preset.voice,
                      label: ttsVoiceLabel(locale, preset.voice, preset.label),
                    })),
                    ...(!TTS_VOICE_PRESETS.some(
                      (preset) => preset.voice === value && (key === 'default' || preset.role === key),
                    ) && value
                      ? [{ value, label: value }]
                      : []),
                  ]}
                  onValueChange={(next) => {
                    if (next) setter(next);
                  }}
                >
                  <SelectTrigger id={`settings-tts-${key}`} appearance="filled" className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {TTS_VOICE_PRESETS.filter((preset) => key === 'default' || preset.role === key).map((preset) => (
                        <SelectItem key={preset.voice} value={preset.voice}>
                          {ttsVoiceLabel(locale, preset.voice, preset.label)}
                        </SelectItem>
                      ))}
                      {!TTS_VOICE_PRESETS.some(
                        (preset) => preset.voice === value && (key === 'default' || preset.role === key),
                      ) && value ? (
                        <SelectItem value={value}>{value}</SelectItem>
                      ) : null}
                    </SelectGroup>
                  </SelectContent>
                </Select>
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
    </section>
  );
}
