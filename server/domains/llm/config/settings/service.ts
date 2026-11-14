import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  llmAppSetting as llmAppSettingTable,
  llmModel as llmModelTable,
  llmProvider as llmProviderTable,
} from '@/server/db';
import { AI_SETTING_KEY_VALUES, isLlmApiFamily, type LlmAppSettingView, type PutLlmAppSettingBody } from '@/shared/llm';

import { putSettingRecord } from '@/server/domains/llm/config/mutations';
import { isModelRuntimeReady } from '@/server/domains/llm/runtime/readiness';
import { db } from '@/server/infra/db';

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
  return putSettingRecord(null, key, body);
}
