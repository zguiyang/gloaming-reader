import { and, eq, isNull, sql } from 'drizzle-orm';

import { llmModel as llmModelTable, llmProvider as llmProviderTable } from '@/server/db';
import type { LlmApiFamily } from '@/shared/llm';
import { assertWireVariantForFamily, isLlmApiFamily, isRuntimeImplemented } from '@/shared/llm';

import { db } from '@/server/infra/db';
import { decryptApiKey } from '@/server/infra/llm/crypto';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

function normalizeLlmBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * When a (typically user BYOK) provider omits proxyUrl, reuse the instance
 * provider proxy for the same base URL so local outbound routing matches Admin.
 */
async function resolveInstanceProxyForBaseUrl(baseUrl: string): Promise<string | null> {
  const normalized = normalizeLlmBaseUrl(baseUrl);
  const rows = await db
    .select({ proxyUrl: llmProviderTable.proxyUrl })
    .from(llmProviderTable)
    .where(
      and(
        isNull(llmProviderTable.ownerUserId),
        sql`rtrim(${llmProviderTable.baseUrl}, '/') = ${normalized}`,
        sql`${llmProviderTable.proxyUrl} is not null`,
        sql`length(btrim(${llmProviderTable.proxyUrl})) > 0`,
      ),
    )
    .limit(1);
  const proxy = rows[0]?.proxyUrl?.trim();
  return proxy || null;
}

export type ResolvedLlm = {
  modelRowId: string;
  providerId: string;
  providerName: string;
  apiFamily: LlmApiFamily;
  wireVariant: string;
  label: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  proxyUrl: string | null;
  thinkingParam: string | null;
  temperature: number | null;
  maxTokens: number | null;
};

/**
 * Load an enabled model + provider and decrypt the API key.
 * Callers must pass a concrete model row id (purpose → setting lives in modules/ai).
 */
export async function resolveLlmByModelRowId(modelRowId: string): Promise<ResolvedLlm> {
  const rows = await db
    .select({
      modelRowId: llmModelTable.id,
      providerId: llmModelTable.providerId,
      providerName: llmProviderTable.name,
      apiFamily: llmProviderTable.apiFamily,
      label: llmModelTable.label,
      modelId: llmModelTable.modelId,
      wireVariant: llmModelTable.wireVariant,
      temperature: llmModelTable.temperature,
      maxTokens: llmModelTable.maxTokens,
      modelEnabled: llmModelTable.isEnabled,
      baseUrl: llmProviderTable.baseUrl,
      proxyUrl: llmProviderTable.proxyUrl,
      thinkingParam: llmProviderTable.thinkingParam,
      apiKeyCiphertext: llmProviderTable.apiKeyCiphertext,
      providerEnabled: llmProviderTable.isEnabled,
    })
    .from(llmModelTable)
    .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
    .where(eq(llmModelTable.id, modelRowId))
    .limit(1);

  const row = rows[0];
  if (!row || !row.modelEnabled || !row.providerEnabled) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.UNAVAILABLE);
  }

  if (!isLlmApiFamily(row.apiFamily)) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.UNAVAILABLE);
  }

  try {
    assertWireVariantForFamily(row.apiFamily, row.wireVariant);
  } catch {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.UNAVAILABLE);
  }

  if (!isRuntimeImplemented(row.apiFamily)) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.LLM.FAMILY_NOT_IMPLEMENTED, {
      apiFamily: row.apiFamily,
    });
  }

  let apiKey: string;
  try {
    apiKey = decryptApiKey(row.apiKeyCiphertext);
  } catch {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.UNAVAILABLE);
  }

  const ownProxy = row.proxyUrl?.trim() || null;
  const proxyUrl = ownProxy ?? (await resolveInstanceProxyForBaseUrl(row.baseUrl));

  return {
    modelRowId: row.modelRowId,
    providerId: row.providerId,
    providerName: row.providerName,
    apiFamily: row.apiFamily,
    wireVariant: row.wireVariant,
    label: row.label,
    modelId: row.modelId,
    baseUrl: row.baseUrl,
    apiKey,
    proxyUrl,
    thinkingParam: row.thinkingParam ?? null,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
  };
}
