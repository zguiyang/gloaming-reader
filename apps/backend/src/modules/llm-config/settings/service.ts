import { eq, inArray } from 'drizzle-orm';

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

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError, NotFoundError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { parseApiFamily } from '@/modules/llm-config/shared/api-family';
import { isModelRuntimeReady } from '@/modules/llm-config/shared/runtime-readiness';

export async function listSettings(): Promise<LlmAppSettingView[]> {
  const settings = await db.select().from(llmAppSettingTable);
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
          .where(inArray(llmModelTable.id, modelIds))
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
    .values({ key: key as AiSettingKey, value: body.modelId })
    .onConflictDoUpdate({
      target: llmAppSettingTable.key,
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
