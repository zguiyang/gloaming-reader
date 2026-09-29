import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  llmAppSetting as llmAppSettingTable,
  llmModel as llmModelTable,
  llmProvider as llmProviderTable,
} from '@gloaming/db';
import {
  AI_SETTING_KEY_VALUES,
  type AiSettingKey,
  isAiSettingKey,
  isLlmApiFamily,
  type LlmAppSettingView,
  type PutLlmAppSettingBody,
} from '@gloaming/shared/llm';

import { parseApiFamily } from '@/domains/llm/config/api-family';
import { isModelRuntimeReady } from '@/domains/llm/runtime/readiness';
import { db } from '@/infra/db';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError, NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

export async function listSettings(): Promise<LlmAppSettingView[]> {
  const settings = await db.select().from(llmAppSettingTable).where(isNull(llmAppSettingTable.ownerUserId));
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
          })
          .from(llmModelTable)
          .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
          .where(and(inArray(llmModelTable.id, modelIds), isNull(llmProviderTable.ownerUserId)))
      : [];
  const modelById = new Map(models.map((m) => [m.id, m]));

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

export async function putSetting(key: string, body: PutLlmAppSettingBody): Promise<LlmAppSettingView> {
  if (!isAiSettingKey(key)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.UNKNOWN_SETTING_KEY);
  }

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
    .where(and(eq(llmModelTable.id, body.modelId), isNull(llmProviderTable.ownerUserId)))
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
      ownerUserId: null,
      key: key as AiSettingKey,
      value: body.modelId,
    })
    .onConflictDoUpdate({
      target: llmAppSettingTable.key,
      targetWhere: isNull(llmAppSettingTable.ownerUserId),
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
