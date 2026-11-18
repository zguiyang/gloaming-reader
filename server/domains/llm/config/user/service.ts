import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import {
  llmAppSetting as llmAppSettingTable,
  llmModel as llmModelTable,
  llmProvider as llmProviderTable,
} from '@/server/db';
import {
  AI_SETTING_KEY_VALUES,
  type LlmAppSettingView,
  type LlmModel,
  type LlmProvider,
  type PutLlmAppSettingBody,
  isLlmApiFamily,
} from '@/shared/llm';

import { toModelView, toProviderView } from '@/server/domains/llm/config/mappers';
import { putSettingRecord } from '@/server/domains/llm/config/mutations';
import { isModelRuntimeReady } from '@/server/domains/llm/runtime/readiness';
import { db } from '@/server/infra/db';

export type AvailableInstanceModels = {
  providers: LlmProvider[];
  models: LlmModel[];
};

/** Instance providers + enabled models users may bind to reading purposes. */
export async function listAvailableInstanceModels(): Promise<AvailableInstanceModels> {
  const providerRows = await db
    .select()
    .from(llmProviderTable)
    .where(and(isNull(llmProviderTable.ownerUserId), eq(llmProviderTable.isEnabled, true)))
    .orderBy(asc(llmProviderTable.createdAt));

  const providers = providerRows
    .filter((row) => isLlmApiFamily(row.apiFamily) && isModelRuntimeReady(row.apiFamily))
    .map(toProviderView);

  if (providers.length === 0) {
    return { providers: [], models: [] };
  }

  const providerIds = providers.map((provider) => provider.id);
  const modelRows = await db
    .select({ model: llmModelTable })
    .from(llmModelTable)
    .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
    .where(
      and(
        inArray(llmModelTable.providerId, providerIds),
        eq(llmModelTable.isEnabled, true),
        isNull(llmProviderTable.ownerUserId),
      ),
    )
    .orderBy(asc(llmModelTable.sortOrder), asc(llmModelTable.createdAt));

  return {
    providers,
    models: modelRows.map((row) => toModelView(row.model)),
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
  // Only instance-owned models count as healthy for user purpose bindings.
  const modelById = new Map(models.filter((m) => m.ownerUserId == null).map((m) => [m.id, m]));

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

export async function putUserSetting(
  userId: string,
  key: string,
  body: PutLlmAppSettingBody,
): Promise<LlmAppSettingView> {
  return putSettingRecord(userId, key, body);
}
