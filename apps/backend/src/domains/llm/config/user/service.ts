import { randomUUID } from 'node:crypto';

import { asc, eq, inArray } from 'drizzle-orm';

import {
  llmAppSetting as llmAppSettingTable,
  llmModel as llmModelTable,
  llmProvider as llmProviderTable,
} from '@gloaming/db';
import {
  AI_SETTING_KEY_VALUES,
  type AiSettingKey,
  assertWireVariantForFamily,
  type CreateLlmModelBody,
  type CreateLlmProviderBody,
  getDefaultWireVariant,
  isAiSettingKey,
  isLlmApiFamily,
  type LlmAppSettingView,
  type LlmModel,
  type LlmModelListQuery,
  type LlmProvider,
  type PutLlmAppSettingBody,
  type UpdateLlmModelBody,
  type UpdateLlmProviderBody,
} from '@gloaming/shared/llm';

import { parseApiFamily } from '@/domains/llm/config/api-family';
import { settingReferencesModel } from '@/domains/llm/config/settings/references';
import { isModelRuntimeReady } from '@/domains/llm/runtime/readiness';
import {
  assertModelAccessibleForActor,
  requireUserOwnedProvider,
  runtimeActorFromUserId,
} from '@/domains/provider-scope';
import { db } from '@/infra/db';
import { assertSafeOutboundUrl, decryptApiKey, encryptApiKey, maskApiKey } from '@/infra/llm';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError, NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

type ProviderRow = typeof llmProviderTable.$inferSelect;
type ModelRow = typeof llmModelTable.$inferSelect;

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

function toModel(row: ModelRow): LlmModel {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    label: row.label,
    wireVariant: row.wireVariant,
    contextLength: row.contextLength,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    isEnabled: row.isEnabled,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listUserProviders(userId: string): Promise<LlmProvider[]> {
  const rows = await db
    .select()
    .from(llmProviderTable)
    .where(eq(llmProviderTable.ownerUserId, userId))
    .orderBy(asc(llmProviderTable.createdAt));
  return rows.map(toProvider);
}

export async function createUserProvider(userId: string, body: CreateLlmProviderBody): Promise<LlmProvider> {
  const apiFamily = parseApiFamily(body.apiFamily);
  assertSafeOutboundUrl(body.baseUrl, 'Base URL');

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
      ownerUserId: userId,
    })
    .returning();
  return toProvider(row!);
}

export async function updateUserProvider(
  userId: string,
  id: string,
  body: UpdateLlmProviderBody,
): Promise<LlmProvider> {
  await requireUserOwnedProvider(id, userId);
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
    patch.thinkingParam = body.thinkingParam;
  }
  if (body.balanceEndpoint !== undefined) {
    patch.balanceEndpoint = body.balanceEndpoint;
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

export async function deleteUserProvider(userId: string, id: string): Promise<void> {
  await requireUserOwnedProvider(id, userId);
  const models = await db.select({ id: llmModelTable.id }).from(llmModelTable).where(eq(llmModelTable.providerId, id));
  if (await settingReferencesModel(models.map((m) => m.id))) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.LLM.MODEL_REFERENCED);
  }
  await db.delete(llmProviderTable).where(eq(llmProviderTable.id, id));
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
  return rows.map(toModel);
}

export async function createUserModel(userId: string, body: CreateLlmModelBody): Promise<LlmModel> {
  const providerRow = await requireUserOwnedProvider(body.providerId, userId);
  const apiFamily = parseApiFamily(providerRow.apiFamily);
  const wireVariant = body.wireVariant ?? getDefaultWireVariant(apiFamily);
  try {
    assertWireVariantForFamily(apiFamily, wireVariant);
  } catch {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.WIRE_VARIANT_INVALID);
  }

  const id = randomUUID();
  const [row] = await db
    .insert(llmModelTable)
    .values({
      id,
      providerId: body.providerId,
      modelId: body.modelId,
      label: body.label,
      wireVariant,
      contextLength: body.contextLength ?? null,
      temperature: body.temperature ?? null,
      maxTokens: body.maxTokens ?? null,
      isEnabled: body.isEnabled,
      sortOrder: body.sortOrder,
    })
    .returning();
  return toModel(row!);
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
  const apiFamily = parseApiFamily(existing[0].apiFamily);

  const patch: Partial<typeof llmModelTable.$inferInsert> = {};
  if (body.modelId !== undefined) {
    patch.modelId = body.modelId;
  }
  if (body.label !== undefined) {
    patch.label = body.label;
  }
  if (body.wireVariant !== undefined) {
    assertWireVariantForFamily(apiFamily, body.wireVariant);
    patch.wireVariant = body.wireVariant;
  }
  if (body.contextLength !== undefined) {
    patch.contextLength = body.contextLength;
  }
  if (body.temperature !== undefined) {
    patch.temperature = body.temperature;
  }
  if (body.maxTokens !== undefined) {
    patch.maxTokens = body.maxTokens;
  }
  if (body.isEnabled !== undefined) {
    patch.isEnabled = body.isEnabled;
  }
  if (body.sortOrder !== undefined) {
    patch.sortOrder = body.sortOrder;
  }

  const [row] = await db.update(llmModelTable).set(patch).where(eq(llmModelTable.id, id)).returning();
  return toModel(row!);
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
  if (await settingReferencesModel([id])) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.LLM.MODEL_REFERENCED);
  }
  await db.delete(llmModelTable).where(eq(llmModelTable.id, id));
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
  if (!isAiSettingKey(key)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.UNKNOWN_SETTING_KEY);
  }

  const actor = runtimeActorFromUserId(userId);
  await assertModelAccessibleForActor(body.modelId, actor);

  const models = await db
    .select({
      id: llmModelTable.id,
      label: llmModelTable.label,
      modelEnabled: llmModelTable.isEnabled,
      providerEnabled: llmProviderTable.isEnabled,
      apiFamily: llmProviderTable.apiFamily,
    })
    .from(llmModelTable)
    .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
    .where(eq(llmModelTable.id, body.modelId))
    .limit(1);

  const model = models[0];
  if (!model) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_MODEL);
  }
  if (!model.modelEnabled || !model.providerEnabled) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.MODEL_OR_PROVIDER_DISABLED);
  }
  const apiFamily = parseApiFamily(model.apiFamily);
  if (!isModelRuntimeReady(apiFamily)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.FAMILY_NOT_IMPLEMENTED, { apiFamily });
  }

  await db
    .insert(llmAppSettingTable)
    .values({
      id: randomUUID(),
      ownerUserId: userId,
      key: key as AiSettingKey,
      value: body.modelId,
    })
    .onConflictDoUpdate({
      target: [llmAppSettingTable.ownerUserId, llmAppSettingTable.key],
      set: { value: body.modelId, updatedAt: new Date() },
    });

  return {
    key: key as AiSettingKey,
    modelId: model.id,
    modelLabel: model.label,
    healthy: true,
    runtimeReady: true,
  };
}
