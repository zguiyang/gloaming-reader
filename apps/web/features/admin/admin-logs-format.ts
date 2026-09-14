import type { DayPickerLocale } from 'react-day-picker/locale';
import { enUS, zhCN } from 'react-day-picker/locale';

import { type Locale, t } from '@gloaming/i18n';

const AI_SOURCE_KEYS: Record<string, string> = {
  'assist.ask': 'assistAsk',
  'assist.ask.followups': 'assistAskFollowups',
  'translate.part': 'translatePart',
  'translate.article': 'translateArticle',
  'admin.provider_test': 'adminProviderTest',
  'metadata-enrich.fill': 'metadataEnrichFill',
  'dictionary:enrichment': 'dictionaryEnrichment',
};

const AI_PURPOSE_KEYS: Record<string, string> = {
  assist: 'assist',
  translate: 'translate',
  'metadata-enrich': 'metadataEnrich',
};

const TTS_SOURCE_KEYS: Record<string, string> = {
  'admin.part_audio': 'adminPartAudio',
  'admin.article_audio': 'adminArticleAudio',
  'admin.tts_test': 'adminTtsTest',
};

const TTS_ROLE_KEYS: Record<string, string> = {
  us: 'us',
  uk: 'uk',
};

function formatEnumLabel(locale: Locale, group: string, keyMap: Record<string, string>, value: string): string {
  const messageKey = keyMap[value];
  if (!messageKey) {
    return value;
  }
  return t(locale, `admin.logs.enum.${group}.${messageKey}`);
}

export function getAdminDayPickerLocale(locale: Locale): DayPickerLocale {
  return locale === 'zh-CN' ? zhCN : enUS;
}

export function formatAdminDateTime(iso: string | Date, locale: Locale, withSeconds = false): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

export function formatAdminCount(value: number | null | undefined, locale: Locale): string {
  if (value == null) {
    return t(locale, 'admin.logs.emptyValue');
  }
  return new Intl.NumberFormat(locale).format(value);
}

export function formatAdminBalance(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatAdminInvocationStatus(status: 'success' | 'failure', locale: Locale): string {
  return t(locale, status === 'success' ? 'admin.logs.status.success' : 'admin.logs.status.failure');
}

export function formatAdminAiSource(source: string, locale: Locale): string {
  return formatEnumLabel(locale, 'aiSource', AI_SOURCE_KEYS, source);
}

export function formatAdminAiPurpose(purpose: string | null, locale: Locale): string {
  if (!purpose) {
    return t(locale, 'admin.logs.enum.aiPurpose.unbound');
  }
  return formatEnumLabel(locale, 'aiPurpose', AI_PURPOSE_KEYS, purpose);
}

export function formatAdminTtsSource(source: string, locale: Locale): string {
  return formatEnumLabel(locale, 'ttsSource', TTS_SOURCE_KEYS, source);
}

export function formatAdminTtsRole(role: string | null, locale: Locale): string {
  if (!role) {
    return t(locale, 'admin.logs.enum.ttsRole.default');
  }
  return formatEnumLabel(locale, 'ttsRole', TTS_ROLE_KEYS, role);
}

export function formatAdminLatencyMs(latencyMs: number | null, locale: Locale): string {
  if (latencyMs == null) {
    return t(locale, 'admin.logs.emptyValue');
  }
  return t(locale, 'admin.logs.latencyMs', { ms: formatAdminCount(latencyMs, locale) });
}
