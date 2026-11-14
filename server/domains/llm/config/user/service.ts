import { asc, eq, inArray } from 'drizzle-orm';

import {
  llmAppSetting as llmAppSettingTable,
  llmModel as llmModelTable,
  llmProvider as llmProviderTable,
} from '@/server/db';
import {
  AI_SETTING_KEY_VALUES,
  type CreateLlmModelBody,
  type CreateLlmProviderBody,
  isLlmApiFamily,
  type LlmAppSettingView,
  type LlmModel,
  type LlmModelListQuery,
  type LlmProvider,
  type PutLlmAppSettingBody,
  type TestLlmProviderResult,
  type UpdateLlmModelBody,
  type UpdateLlmProviderBody,
} from '@/shared/llm';

import { invokeAi } from '@/server/domains/ai';
import { parseApiFamily } from '@/server/domains/llm/config/api-family';
import { toModelView, toProviderView } from '@/server/domains/llm/config/mappers';
import {
  createModelRecord,
  createProviderRecord,
  deleteModelRecord,
  deleteProviderRecord,
  putSettingRecord,
  updateModelRecord,
  updateProviderRecord,
} from '@/server/domains/llm/config/mutations';
import { isModelRuntimeReady } from '@/server/domains/llm/runtime/readiness';
import { requireUserOwnedProvider } from '@/server/domains/provider-scope';
import { db } from '@/server/infra/db';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError, NotFoundError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

export async function listUserProviders(userId: string): Promise<LlmProvider[]> {
  const rows = await db
    .select()
    .from(llmProviderTable)
    .where(eq(llmProviderTable.ownerUserId, userId))
    .orderBy(asc(llmProviderTable.createdAt));
  return rows.map(toProviderView);
}

export async function createUserProvider(userId: string, body: CreateLlmProviderBody): Promise<LlmProvider> {
  return createProviderRecord(userId, body);
}

export async function updateUserProvider(
  userId: string,
  id: string,
  body: UpdateLlmProviderBody,
): Promise<LlmProvider> {
  const existing = await requireUserOwnedProvider(id, userId);
  return updateProviderRecord(existing, body);
}

export async function deleteUserProvider(userId: string, id: string): Promise<void> {
  await requireUserOwnedProvider(id, userId);
  await deleteProviderRecord(id);
}

export async function listUserModels(userId: string, query: LlmModelListQuery): Promise<LlmModel[]> {
  if (!query.providerId) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_INVALID_INPUT);
  }
  await requireUserOwnedProvider(query.providerId, userId);
  const rows = await db
    .select()
    .from(llmModelTable)
    .where(eq(llmModelTable.providerId, query.providerId))
    .orderBy(asc(llmModelTable.sortOrder), asc(llmModelTable.createdAt));
  return rows.map(toModelView);
}

export async function createUserModel(userId: string, body: CreateLlmModelBody): Promise<LlmModel> {
  const providerRow = await requireUserOwnedProvider(body.providerId, userId);
  return createModelRecord(providerRow, body);
}

export async function updateUserModel(userId: string, id: string, body: UpdateLlmModelBody): Promise<LlmModel> {
  const existing = await db
    .select({
      model: llmModelTable,
      ownerUserId: llmProviderTable.ownerUserId,
      apiFamily: llmProviderTable.apiFamily,
    })
    .from(llmModelTable)
    .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
    .where(eq(llmModelTable.id, id))
    .limit(1);
  if (!existing[0] || existing[0].ownerUserId !== userId) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_MODEL);
  }
  return updateModelRecord(id, parseApiFamily(existing[0].apiFamily), body);
}

export async function deleteUserModel(userId: string, id: string): Promise<void> {
  const existing = await db
    .select({ ownerUserId: llmProviderTable.ownerUserId })
    .from(llmModelTable)
    .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
    .where(eq(llmModelTable.id, id))
    .limit(1);
  if (!existing[0] || existing[0].ownerUserId !== userId) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_MODEL);
  }
  await deleteModelRecord(id);
}

export async function testUserModel(userId: string, id: string): Promise<TestLlmProviderResult> {
  const existing = await db
    .select({
      modelEnabled: llmModelTable.isEnabled,
      ownerUserId: llmProviderTable.ownerUserId,
      providerEnabled: llmProviderTable.isEnabled,
      apiFamily: llmProviderTable.apiFamily,
    })
    .from(llmModelTable)
    .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
    .where(eq(llmModelTable.id, id))
    .limit(1);
  if (!existing[0] || existing[0].ownerUserId !== userId) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_MODEL);
  }
  if (!existing[0].modelEnabled || !existing[0].providerEnabled) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.MODEL_OR_PROVIDER_DISABLED);
  }
  const apiFamily = parseApiFamily(existing[0].apiFamily);
  if (!isModelRuntimeReady(apiFamily)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.FAMILY_NOT_IMPLEMENTED, { apiFamily });
  }

  const started = Date.now();
  const result = await invokeAi({
    modelRowId: id,
    source: 'user.provider_test',
    userId,
    messages: [
      { role: 'system', content: 'Reply with exactly: ok' },
      { role: 'user', content: 'ping' },
    ],
    timeoutMs: 30_000,
    maxRetries: 0,
  });

  return {
    ok: true,
    latencyMs: Date.now() - started,
    modelLabel: result.model.label,
  };
}

export async function listUserSettings(userId: string): Promise<LlmAppSettingView[]> {
  const settings = await db.select().from(llmAppSettingTable).where(eq(llmAppSettingTable.ownerUserId, userId));
  const byKey = new Map(settings.map((s) => [s.key, s.value]));
  const modelIds = [...new Set([...byKey.values()].filter(Boolean))];
  const models =
    modelIds.length > 0
      ? await db
          .select({
            id: llmModelTable.id,
            label: llmModelTable.label,
            modelEnabled: llmModelTable.isEnabled,
            providerEnabled: llmProviderTable.isEnabled,
            apiFamily: llmProviderTable.apiFamily,
            ownerUserId: llmProviderTable.ownerUserId,
          })
          .from(llmModelTable)
          .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
          .where(inArray(llmModelTable.id, modelIds))
      : [];
  const modelById = new Map(
    models.filter((m) => isProviderModelVisibleToUser(m.ownerUserId, userId)).map((m) => [m.id, m]),
  );

  return AI_SETTING_KEY_VALUES.map((key) => {
    const modelId = byKey.get(key) ?? null;
    const model = modelId ? modelById.get(modelId) : undefined;
    const apiFamily = model && isLlmApiFamily(model.apiFamily) ? model.apiFamily : null;
    const runtimeReady = apiFamily ? isModelRuntimeReady(apiFamily) : false;
    const healthy = Boolean(model?.modelEnabled && model.providerEnabled && runtimeReady);
    return {
      key,
      modelId: model ? model.id : modelId,
      modelLabel: model?.label ?? null,
      healthy,
      runtimeReady,
    };
  });
}

function isProviderModelVisibleToUser(ownerUserId: string | null, userId: string): boolean {
  return ownerUserId == null || ownerUserId === userId;
}

export async function putUserSetting(
  userId: string,
  key: string,
  body: PutLlmAppSettingBody,
): Promise<LlmAppSettingView> {
  return putSettingRecord(userId, key, body);
}
