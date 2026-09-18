import { eq } from 'drizzle-orm';

import { dictionaryConfig as dictionaryConfigTable } from '@gloaming/db';
import {
  DEFAULT_DICTIONARY_CONFIG,
  type DictionaryConfigView,
  type PutDictionaryConfigBody,
} from '@gloaming/shared/dictionary';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { decryptApiKey, encryptApiKey, maskApiKey } from '@/lib/llm';
import { rootLogger } from '@/lib/logger';
import { getRedis } from '@/lib/redis';
import { isDictionaryProviderRegistered } from '@/modules/dictionary/provider-registry';

export const DICTIONARY_CONFIG_ID = 'default';

const logger = rootLogger.child({ module: 'DictionaryService' });

type DictionaryConfigRow = typeof dictionaryConfigTable.$inferSelect;

const REDIS_CONFIG_KEY = 'gloaming:dictionary:config:default';
const REDIS_CONFIG_TTL_SECONDS = 3600;

function emptyConfigView(): DictionaryConfigView {
  return {
    configured: false,
    provider: DEFAULT_DICTIONARY_CONFIG.provider,
    isEnabled: DEFAULT_DICTIONARY_CONFIG.isEnabled,
    enableAiEnrichment: DEFAULT_DICTIONARY_CONFIG.enableAiEnrichment,
    customEndpoint: DEFAULT_DICTIONARY_CONFIG.customEndpoint,
    apiKeySet: false,
    apiKeyMasked: null,
    timeoutMs: DEFAULT_DICTIONARY_CONFIG.timeoutMs,
    cacheTtlDays: DEFAULT_DICTIONARY_CONFIG.cacheTtlDays,
    updatedAt: null,
  };
}

function toConfigView(row: DictionaryConfigRow): DictionaryConfigView {
  let apiKeyMasked: string | null = null;
  if (row.apiKeyCiphertext) {
    try {
      apiKeyMasked = maskApiKey(decryptApiKey(row.apiKeyCiphertext));
    } catch {
      apiKeyMasked = '****';
    }
  }

  return {
    configured: true,
    provider: row.provider,
    isEnabled: row.isEnabled,
    enableAiEnrichment: row.enableAiEnrichment,
    customEndpoint: row.customEndpoint,
    apiKeySet: Boolean(row.apiKeyCiphertext),
    apiKeyMasked,
    timeoutMs: row.timeoutMs,
    cacheTtlDays: row.cacheTtlDays,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function loadConfigRow(): Promise<DictionaryConfigRow | null> {
  const rows = await db
    .select()
    .from(dictionaryConfigTable)
    .where(eq(dictionaryConfigTable.id, DICTIONARY_CONFIG_ID))
    .limit(1);
  return rows[0] ?? null;
}

export async function getDictionaryConfig(): Promise<DictionaryConfigView> {
  try {
    const cached = await getRedis().get(REDIS_CONFIG_KEY);
    if (cached) {
      return JSON.parse(cached) as DictionaryConfigView;
    }
  } catch (err) {
    logger.warn({ err }, 'Redis dictionary config cache read failed');
  }

  const row = await loadConfigRow();
  const view = row ? toConfigView(row) : emptyConfigView();

  try {
    await getRedis().set(REDIS_CONFIG_KEY, JSON.stringify(view), 'EX', REDIS_CONFIG_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err }, 'Redis dictionary config cache write failed');
  }

  return view;
}

export async function putDictionaryConfig(body: PutDictionaryConfigBody): Promise<DictionaryConfigView> {
  const providerId = body.provider.trim();
  if (!isDictionaryProviderRegistered(providerId)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.DICTIONARY.PROVIDER_SAVE_NOT_SUPPORTED, { providerId });
  }

  const existing = await loadConfigRow();

  let apiKeyCiphertext: string | null = null;
  if (body.apiKey?.trim()) {
    apiKeyCiphertext = encryptApiKey(body.apiKey.trim());
  } else if (existing?.apiKeyCiphertext) {
    apiKeyCiphertext = existing.apiKeyCiphertext;
  }

  const values = {
    id: DICTIONARY_CONFIG_ID,
    provider: providerId,
    isEnabled: body.isEnabled,
    enableAiEnrichment: body.enableAiEnrichment,
    customEndpoint: body.customEndpoint?.trim() || null,
    apiKeyCiphertext,
    timeoutMs: body.timeoutMs ?? DEFAULT_DICTIONARY_CONFIG.timeoutMs,
    cacheTtlDays: body.cacheTtlDays ?? DEFAULT_DICTIONARY_CONFIG.cacheTtlDays,
    updatedAt: new Date(),
  };

  const [savedRow] = await db
    .insert(dictionaryConfigTable)
    .values(values)
    .onConflictDoUpdate({
      target: dictionaryConfigTable.id,
      set: {
        provider: values.provider,
        isEnabled: values.isEnabled,
        enableAiEnrichment: values.enableAiEnrichment,
        customEndpoint: values.customEndpoint,
        apiKeyCiphertext: values.apiKeyCiphertext,
        timeoutMs: values.timeoutMs,
        cacheTtlDays: values.cacheTtlDays,
        updatedAt: values.updatedAt,
      },
    })
    .returning();

  const view = toConfigView(savedRow);

  try {
    await getRedis().del(REDIS_CONFIG_KEY);
  } catch (err) {
    logger.warn({ err }, 'Failed to invalidate redis dictionary config cache');
  }

  return view;
}
