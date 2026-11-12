import { type Locale, t } from '@gloaming/i18n';
import type { LlmApiFamily } from '@gloaming/shared/llm';
import { getWireFamilyDefinition, getWireVariantLabel } from '@gloaming/shared/llm';

function protocolFamilyKey(apiFamily: LlmApiFamily): string {
  return `admin.ai.protocol.family.${apiFamily}`;
}

function protocolWireVariantKey(apiFamily: LlmApiFamily, wireVariant: string): string {
  return `admin.ai.protocol.wireVariant.${apiFamily}.${wireVariant}`;
}

function hasTranslation(locale: Locale, key: string): string | null {
  const translated = t(locale, key);
  return translated === key ? null : translated;
}

/** Localized display label for an LLM API family; falls back to shared registry label. */
export function getApiFamilyLabel(locale: Locale, apiFamily: LlmApiFamily): string {
  return hasTranslation(locale, protocolFamilyKey(apiFamily)) ?? getWireFamilyDefinition(apiFamily).label;
}

/** Localized display label for a wire variant; falls back to shared registry label or raw id. */
export function getWireVariantDisplayLabel(locale: Locale, apiFamily: LlmApiFamily, wireVariant: string): string {
  return (
    hasTranslation(locale, protocolWireVariantKey(apiFamily, wireVariant)) ??
    getWireVariantLabel(apiFamily, wireVariant)
  );
}
