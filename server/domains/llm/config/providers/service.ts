import { and, asc, eq, isNull } from 'drizzle-orm';

import { llmModel as llmModelTable, llmProvider as llmProviderTable } from '@/server/db';
import {
  type CreateLlmProviderBody,
  type FetchProviderModelsResult,
  getWireFamilyDefinition,
  isLlmApiFamily,
  type LlmProvider,
  type ProviderBalanceResult,
  type TestLlmProviderBody,
  type TestLlmProviderResult,
  type UpdateLlmProviderBody,
} from '@/shared/llm';

import { invokeAi } from '@/server/domains/ai';
import { parseApiFamily } from '@/server/domains/llm/config/api-family';
import { toProviderView } from '@/server/domains/llm/config/mappers';
import {
  createProviderRecord,
  deleteProviderRecord,
  updateProviderRecord,
} from '@/server/domains/llm/config/mutations';
import { isModelRuntimeReady } from '@/server/domains/llm/runtime/readiness';
import { requireInstanceProvider } from '@/server/domains/provider-scope';
import { db } from '@/server/infra/db';
import {
  decryptApiKey,
  fetchProviderModelCandidates,
  queryProviderBalance as queryProviderBalanceUpstream,
} from '@/server/infra/llm';
import { createLogger } from '@/server/infra/logging/logger';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError, NotFoundError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

const llmProviderLogger = createLogger('LlmProviders');

type ProviderRow = typeof llmProviderTable.$inferSelect;

export async function listProviders(): Promise<LlmProvider[]> {
  const rows = await db
    .select()
    .from(llmProviderTable)
    .where(isNull(llmProviderTable.ownerUserId))
    .orderBy(asc(llmProviderTable.createdAt));
  return rows.map(toProviderView);
}

export async function createProvider(body: CreateLlmProviderBody): Promise<LlmProvider> {
  return createProviderRecord(null, body);
}

export async function updateProvider(id: string, body: UpdateLlmProviderBody): Promise<LlmProvider> {
  const existing = await requireInstanceProvider(id);
  return updateProviderRecord(existing, body);
}

export async function deleteProvider(id: string): Promise<void> {
  await requireInstanceProvider(id);
  await deleteProviderRecord(id);
}

export async function testProvider(providerId: string, body: TestLlmProviderBody): Promise<TestLlmProviderResult> {
  const providerRow = await requireInstanceProvider(providerId);
  const provider = [providerRow];
  if (!provider[0].isEnabled) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.PROVIDER_DISABLED);
  }
  const apiFamily = parseApiFamily(provider[0].apiFamily);
  if (!isModelRuntimeReady(apiFamily)) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.LLM.FAMILY_NOT_IMPLEMENTED, { apiFamily });
  }

  let modelRowId = body.modelId;
  if (!modelRowId) {
    const models = await db
      .select()
      .from(llmModelTable)
      .where(and(eq(llmModelTable.providerId, providerId), eq(llmModelTable.isEnabled, true)))
      .orderBy(asc(llmModelTable.sortOrder), asc(llmModelTable.createdAt))
      .limit(1);
    modelRowId = models[0]?.id;
  } else {
    const models = await db
      .select()
      .from(llmModelTable)
      .where(and(eq(llmModelTable.id, modelRowId), eq(llmModelTable.providerId, providerId)))
      .limit(1);
    if (!models[0]) {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_MODEL);
    }
  }

  if (!modelRowId) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.NO_ENABLED_MODEL);
  }

  const started = Date.now();
  const result = await invokeAi({
    modelRowId,
    source: 'admin.provider_test',
    messages: [
      { role: 'system', content: 'Reply with exactly: ok' },
      { role: 'user', content: 'ping' },
    ],
    timeoutMs: 30_000,
  });

  return {
    ok: true,
    latencyMs: Date.now() - started,
    modelLabel: result.model.label,
  };
}

async function loadProviderWithKey(providerId: string): Promise<{ row: ProviderRow; apiKey: string }> {
  const row = await requireInstanceProvider(providerId);
  let apiKey: string;
  try {
    apiKey = decryptApiKey(row.apiKeyCiphertext);
  } catch {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.API_KEY_DECRYPT_FAILED);
  }
  return { row, apiKey };
}

export async function fetchProviderModels(providerId: string): Promise<FetchProviderModelsResult> {
  const { row, apiKey } = await loadProviderWithKey(providerId);
  if (!isLlmApiFamily(row.apiFamily)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.INVALID_API_FAMILY);
  }
  const familyDef = getWireFamilyDefinition(row.apiFamily);
  if (!familyDef.provider.capabilities.modelList) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.MODEL_LIST_NOT_SUPPORTED);
  }
  try {
    const models = await fetchProviderModelCandidates(row, apiKey);
    return { models };
  } catch (error) {
    llmProviderLogger.warn({ err: error, providerId }, 'Failed to fetch provider model list');
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.MODEL_LIST_FETCH_FAILED);
  }
}

export async function queryProviderBalance(providerId: string): Promise<ProviderBalanceResult> {
  const { row, apiKey } = await loadProviderWithKey(providerId);
  return queryProviderBalanceUpstream(row, apiKey);
}
