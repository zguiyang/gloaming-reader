import { eq } from 'drizzle-orm';

import { llmModel as llmModelTable, llmProvider as llmProviderTable } from '@gloaming/db';
import type { LlmApiFamily } from '@gloaming/shared/llm';
import { assertWireVariantForFamily, isLlmApiFamily, isRuntimeImplemented } from '@gloaming/shared/llm';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError } from '@/lib/errors';
import { decryptApiKey } from '@/lib/llm/crypto';

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
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'AI unavailable');
  }

  if (!isLlmApiFamily(row.apiFamily)) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'AI unavailable');
  }

  try {
    assertWireVariantForFamily(row.apiFamily, row.wireVariant);
  } catch {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'AI unavailable');
  }

  if (!isRuntimeImplemented(row.apiFamily)) {
    throw new AppError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      `LLM API family "${row.apiFamily}" is registered but runtime support is not implemented.`,
    );
  }

  let apiKey: string;
  try {
    apiKey = decryptApiKey(row.apiKeyCiphertext);
  } catch {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'AI unavailable');
  }

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
    proxyUrl: row.proxyUrl ?? null,
    thinkingParam: row.thinkingParam ?? null,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
  };
}
