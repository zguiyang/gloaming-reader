import { randomUUID } from 'node:crypto';

import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import {
  llmAppSetting as llmAppSettingTable,
  llmModel as llmModelTable,
  llmProvider as llmProviderTable,
} from '@/server/db';
import {
  assertWireVariantForFamily,
  type AiSettingKey,
  type CreateLlmModelBody,
  type CreateLlmProviderBody,
  getDefaultWireVariant,
  isAiSettingKey,
  type LlmApiFamily,
  type LlmAppSettingView,
  type LlmModel,
  type LlmProvider,
  normalizeBalanceEndpoint,
  providerSupportsOptionalField,
  type PutLlmAppSettingBody,
  type UpdateLlmModelBody,
  type UpdateLlmProviderBody,
} from '@/shared/llm';

import { parseApiFamily } from '@/server/domains/llm/config/api-family';
import { toModelView, toProviderView } from '@/server/domains/llm/config/mappers';
import { settingReferencesModel } from '@/server/domains/llm/config/settings/references';
import { isModelRuntimeReady } from '@/server/domains/llm/runtime/readiness';
import { assertModelAccessibleForActor, runtimeActorFromUserId } from '@/server/domains/provider-scope';
import { db } from '@/server/infra/db';
import { assertSafeOutboundUrl, assertSafeProxyUrl, encryptApiKey } from '@/server/infra/llm';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError, NotFoundError, ValidationFailedError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';
import { isUniqueViolation } from '@/server/shared/errors/db-errors';

type ProviderRow = typeof llmProviderTable.$inferSelect;

/**
 * Record writes shared by the instance-scoped (admin) and user-scoped LLM
 * config services. Ownership guards stay with the callers; these functions only
 * encode the row shape and validation that must stay identical for both scopes.
 */

function validateProviderOptionalFields(family: LlmApiFamily, thinkingParam: string | null | undefined): void {
  if (thinkingParam && !providerSupportsOptionalField(family, 'thinkingParam')) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.THINKING_NOT_SUPPORTED);
  }
}

export async function createProviderRecord(
  ownerUserId: string | null,
  body: CreateLlmProviderBody,
): Promise<LlmProvider> {
  const apiFamily = parseApiFamily(body.apiFamily);
  assertSafeOutboundUrl(body.baseUrl, 'Base URL');
  assertSafeProxyUrl(body.proxyUrl);
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
      ownerUserId,
    })
    .returning();
  return toProviderView(row!);
}

export async function updateProviderRecord(existing: ProviderRow, body: UpdateLlmProviderBody): Promise<LlmProvider> {
  const apiFamily = parseApiFamily(existing.apiFamily);
  const patch: Partial<typeof llmProviderTable.$inferInsert> = {};
  if (body.name !== undefined) {
    patch.name = body.name;
  }
  if (body.baseUrl !== undefined) {
    assertSafeOutboundUrl(body.baseUrl, 'Base URL');
    patch.baseUrl = body.baseUrl;
  }
  if (body.proxyUrl !== undefined) {
    assertSafeProxyUrl(body.proxyUrl);
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
      const effectiveBaseUrl = body.baseUrl ?? existing.baseUrl;
      const normalized = normalizeBalanceEndpoint(body.balanceEndpoint, effectiveBaseUrl);
      if (!normalized.ok) {
        throw new ValidationFailedError([{ path: 'balanceEndpoint', code: normalized.code }]);
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

  const [row] = await db.update(llmProviderTable).set(patch).where(eq(llmProviderTable.id, existing.id)).returning();
  // Deleted between the ownership check and this update — surface 404, not a
  // TypeError from `toProviderView(undefined)`.
  if (!row) throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_PROVIDER);
  return toProviderView(row);
}

export async function deleteProviderRecord(id: string): Promise<void> {
  const models = await db.select({ id: llmModelTable.id }).from(llmModelTable).where(eq(llmModelTable.providerId, id));
  if (await settingReferencesModel(models.map((m) => m.id))) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.LLM.MODEL_REFERENCED);
  }
  await db.delete(llmProviderTable).where(eq(llmProviderTable.id, id));
}

export async function createModelRecord(providerRow: ProviderRow, body: CreateLlmModelBody): Promise<LlmModel> {
  const apiFamily = parseApiFamily(providerRow.apiFamily);
  const wireVariant = body.wireVariant ?? getDefaultWireVariant(apiFamily);
  try {
    assertWireVariantForFamily(apiFamily, wireVariant);
  } catch {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.WIRE_VARIANT_INVALID);
  }

  const id = randomUUID();
  try {
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
    if (!row) throw new Error(`LLM model insert produced no row for ${body.modelId}`);
    return toModelView(row);
  } catch (error) {
    // A duplicate (provider, model) is a 409, not an unhandled unique_violation 500.
    if (isUniqueViolation(error)) {
      throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.LLM.MODEL_ID_EXISTS);
    }
    throw error;
  }
}

export async function updateModelRecord(
  id: string,
  apiFamily: LlmApiFamily,
  body: UpdateLlmModelBody,
): Promise<LlmModel> {
  const patch: Partial<typeof llmModelTable.$inferInsert> = {};
  if (body.modelId !== undefined) {
    patch.modelId = body.modelId;
  }
  if (body.label !== undefined) {
    patch.label = body.label;
  }
  if (body.wireVariant !== undefined) {
    try {
      assertWireVariantForFamily(apiFamily, body.wireVariant);
    } catch {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.WIRE_VARIANT_INVALID);
    }
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

  try {
    const [row] = await db.update(llmModelTable).set(patch).where(eq(llmModelTable.id, id)).returning();
    // The row can be deleted between the ownership check and this update;
    // `row!` would throw a TypeError that surfaces as a 500 instead of a 404.
    if (!row) throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_MODEL);
    return toModelView(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.LLM.MODEL_ID_EXISTS);
    }
    throw error;
  }
}

export async function deleteModelRecord(id: string): Promise<void> {
  if (await settingReferencesModel([id])) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.LLM.MODEL_REFERENCED);
  }
  await db.delete(llmModelTable).where(eq(llmModelTable.id, id));
}

export async function putSettingRecord(
  ownerUserId: string | null,
  key: string,
  body: PutLlmAppSettingBody,
): Promise<LlmAppSettingView> {
  if (!isAiSettingKey(key)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.UNKNOWN_SETTING_KEY);
  }

  // User-scoped bindings may point at instance models or the user's own models.
  if (ownerUserId !== null) {
    await assertModelAccessibleForActor(body.modelId, runtimeActorFromUserId(ownerUserId));
  }

  const modelRows = await db
    .select({
      id: llmModelTable.id,
      label: llmModelTable.label,
      modelEnabled: llmModelTable.isEnabled,
      providerEnabled: llmProviderTable.isEnabled,
      apiFamily: llmProviderTable.apiFamily,
    })
    .from(llmModelTable)
    .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
    .where(
      ownerUserId === null
        ? and(eq(llmModelTable.id, body.modelId), isNull(llmProviderTable.ownerUserId))
        : eq(llmModelTable.id, body.modelId),
    )
    .limit(1);

  const model = modelRows[0];
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

  const values = {
    id: randomUUID(),
    ownerUserId,
    key: key as AiSettingKey,
    value: body.modelId,
  };
  if (ownerUserId === null) {
    await db
      .insert(llmAppSettingTable)
      .values(values)
      .onConflictDoUpdate({
        target: llmAppSettingTable.key,
        targetWhere: isNull(llmAppSettingTable.ownerUserId),
        set: { value: body.modelId, updatedAt: new Date() },
      });
  } else {
    await db
      .insert(llmAppSettingTable)
      .values(values)
      .onConflictDoUpdate({
        target: [llmAppSettingTable.ownerUserId, llmAppSettingTable.key],
        targetWhere: isNotNull(llmAppSettingTable.ownerUserId),
        set: { value: body.modelId, updatedAt: new Date() },
      });
  }

  return {
    key: key as AiSettingKey,
    modelId: model.id,
    modelLabel: model.label,
    healthy: true,
    runtimeReady: true,
  };
}
