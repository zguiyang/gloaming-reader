import { type Locale, t } from '@/i18n';

/** Localized display label for a TTS voice; falls back to the preset label. */
export function ttsVoiceLabel(locale: Locale, voice: string, fallback: string): string {
  const key = `settings.tts.voiceName.${voice}`;
  const translated = t(locale, key);
  return translated === key ? fallback : translated;
}
