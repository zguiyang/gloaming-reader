import { randomUUID } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';

import { llmModel as llmModelTable, llmProvider as llmProviderTable } from '@gloaming/db';
import {
  type CreateLlmProviderBody,
  type FetchProviderModelsResult,
  getWireFamilyDefinition,
  isLlmApiFamily,
  type LlmApiFamily,
  type LlmProvider,
  normalizeBalanceEndpoint,
  type ProviderBalanceResult,
  providerSupportsOptionalField,
  type TestLlmProviderBody,
  type TestLlmProviderResult,
  type UpdateLlmProviderBody,
} from '@gloaming/shared/llm';

import { invokeAi } from '@/domains/ai';
import { parseApiFamily } from '@/domains/llm/config/api-family';
import { settingReferencesModel } from '@/domains/llm/config/settings/references';
import { isModelRuntimeReady } from '@/domains/llm/runtime/readiness';
import { requireInstanceProvider } from '@/domains/provider-scope';
import { db } from '@/infra/db';
import {
  assertSafeOutboundUrl,
  decryptApiKey,
  encryptApiKey,
  fetchProviderModelCandidates,
  maskApiKey,
  queryProviderBalance as queryProviderBalanceUpstream,
} from '@/infra/llm';
import { rootLogger } from '@/infra/logging/logger';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError, NotFoundError, ValidationFailedError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

type ProviderRow = typeof llmProviderTable.$inferSelect;

function validateProviderOptionalFields(family: LlmApiFamily, thinkingParam: string | null | undefined): void {
  if (thinkingParam && !providerSupportsOptionalField(family, 'thinkingParam')) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.THINKING_NOT_SUPPORTED);
  }
}

function toProvider(row: ProviderRow): LlmProvider {
  const apiFamily = parseApiFamily(row.apiFamily);
  let apiKeyMasked: string | null = null;
  try {
    apiKeyMasked = maskApiKey(decryptApiKey(row.apiKeyCiphertext));
  } catch {
    apiKeyMasked = '****';
  }
  return {
    id: row.id,
    apiFamily,
    name: row.name,
    baseUrl: row.baseUrl,
    proxyUrl: row.proxyUrl ?? null,
    thinkingParam: row.thinkingParam ?? null,
    balanceEndpoint: row.balanceEndpoint ?? null,
    balanceAmountPath: row.balanceAmountPath ?? null,
    balanceCurrencyPath: row.balanceCurrencyPath ?? null,
    isEnabled: row.isEnabled,
    apiKeySet: true,
    apiKeyMasked,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProviders(): Promise<LlmProvider[]> {
  const rows = await db
    .select()
    .from(llmProviderTable)
    .where(isNull(llmProviderTable.ownerUserId))
    .orderBy(asc(llmProviderTable.createdAt));
  return rows.map(toProvider);
}

export async function createProvider(body: CreateLlmProviderBody): Promise<LlmProvider> {
  const apiFamily = parseApiFamily(body.apiFamily);
  assertSafeOutboundUrl(body.baseUrl, 'Base URL');
  validateProviderOptionalFields(apiFamily, body.thinkingParam);

  const id = randomUUID();
  const [row] = await db
    .insert(llmProviderTable)
    .values({
      id,
      apiFamily,
      name: body.name,
      baseUrl: body.baseUrl,
      apiKeyCiphertext: encryptApiKey(body.apiKey),
      proxyUrl: body.proxyUrl ?? null,
      thinkingParam: body.thinkingParam ?? null,
      balanceEndpoint: body.balanceEndpoint ?? null,
      balanceAmountPath: body.balanceAmountPath ?? null,
      balanceCurrencyPath: body.balanceCurrencyPath ?? null,
      isEnabled: body.isEnabled,
      ownerUserId: null,
    })
    .returning();
  return toProvider(row!);
}

export async function updateProvider(id: string, body: UpdateLlmProviderBody): Promise<LlmProvider> {
  const existingRow = await requireInstanceProvider(id);
  const existing = [existingRow];
  const apiFamily = parseApiFamily(existing[0].apiFamily);

  const patch: Partial<typeof llmProviderTable.$inferInsert> = {};
  if (body.name !== undefined) {
    patch.name = body.name;
  }
  if (body.baseUrl !== undefined) {
    assertSafeOutboundUrl(body.baseUrl, 'Base URL');
    patch.baseUrl = body.baseUrl;
  }
  if (body.proxyUrl !== undefined) {
    patch.proxyUrl = body.proxyUrl;
  }
  if (body.thinkingParam !== undefined) {
    validateProviderOptionalFields(apiFamily, body.thinkingParam);
    patch.thinkingParam = body.thinkingParam;
  }
  if (body.balanceEndpoint !== undefined) {
    if (body.balanceEndpoint == null || !body.balanceEndpoint.trim()) {
      patch.balanceEndpoint = null;
    } else {
      const effectiveBaseUrl = body.baseUrl ?? existing[0].baseUrl;
      const normalized = normalizeBalanceEndpoint(body.balanceEndpoint, effectiveBaseUrl);
      if (!normalized.ok) {
        throw new ValidationFailedError([{ path: 'balanceEndpoint', message: normalized.message }]);
      }
      patch.balanceEndpoint = normalized.value;
    }
  }
  if (body.balanceAmountPath !== undefined) {
    patch.balanceAmountPath = body.balanceAmountPath;
  }
  if (body.balanceCurrencyPath !== undefined) {
    patch.balanceCurrencyPath = body.balanceCurrencyPath;
  }
  if (body.isEnabled !== undefined) {
    patch.isEnabled = body.isEnabled;
  }
  if (body.apiKey !== undefined) {
    patch.apiKeyCiphertext = encryptApiKey(body.apiKey);
  }

  const [row] = await db.update(llmProviderTable).set(patch).where(eq(llmProviderTable.id, id)).returning();
  return toProvider(row!);
}

export async function deleteProvider(id: string): Promise<void> {
  await requireInstanceProvider(id);

  const models = await db.select({ id: llmModelTable.id }).from(llmModelTable).where(eq(llmModelTable.providerId, id));
  if (await settingReferencesModel(models.map((m) => m.id))) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.LLM.MODEL_REFERENCED);
  }

  await db.delete(llmProviderTable).where(eq(llmProviderTable.id, id));
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
    rootLogger.warn({ err: error, providerId }, 'Failed to fetch provider model list');
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.MODEL_LIST_FETCH_FAILED);
  }
}

export async function queryProviderBalance(providerId: string): Promise<ProviderBalanceResult> {
  const { row, apiKey } = await loadProviderWithKey(providerId);
  return queryProviderBalanceUpstream(row, apiKey);
}
