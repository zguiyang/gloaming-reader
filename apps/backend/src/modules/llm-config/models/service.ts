import { randomUUID } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';

import { llmModel as llmModelTable, llmProvider as llmProviderTable } from '@gloaming/db';
import {
  assertWireVariantForFamily,
  type CreateLlmModelBody,
  getDefaultWireVariant,
  listWireFamilies,
  type LlmModel,
  type LlmModelListQuery,
  type UpdateLlmModelBody,
} from '@gloaming/shared/llm';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError, NotFoundError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { parseApiFamily } from '@/modules/llm-config/shared/api-family';
import { settingReferencesModel } from '@/modules/llm-config/shared/setting-references';

type ModelRow = typeof llmModelTable.$inferSelect;

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

export async function listModels(query: LlmModelListQuery): Promise<LlmModel[]> {
  const rows = query.providerId
    ? await db
        .select()
        .from(llmModelTable)
        .where(eq(llmModelTable.providerId, query.providerId))
        .orderBy(asc(llmModelTable.sortOrder), asc(llmModelTable.createdAt))
    : await db.select().from(llmModelTable).orderBy(asc(llmModelTable.sortOrder), asc(llmModelTable.createdAt));
  return rows.map(toModel);
}

export async function createModel(body: CreateLlmModelBody): Promise<LlmModel> {
  const provider = await db.select().from(llmProviderTable).where(eq(llmProviderTable.id, body.providerId)).limit(1);
  if (!provider[0]) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_PROVIDER);
  }
  const apiFamily = parseApiFamily(provider[0].apiFamily);
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
    return toModel(row!);
  } catch {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.LLM.MODEL_ID_EXISTS);
  }
}

export async function updateModel(id: string, body: UpdateLlmModelBody): Promise<LlmModel> {
  const existing = await db
    .select({
      model: llmModelTable,
      apiFamily: llmProviderTable.apiFamily,
    })
    .from(llmModelTable)
    .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
    .where(eq(llmModelTable.id, id))
    .limit(1);
  if (!existing[0]) {
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
    return toModel(row!);
  } catch {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.LLM.MODEL_ID_EXISTS);
  }
}

export async function getWireRegistry() {
  return { families: listWireFamilies() };
}

export async function deleteModel(id: string): Promise<void> {
  const existing = await db.select().from(llmModelTable).where(eq(llmModelTable.id, id)).limit(1);
  if (!existing[0]) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_MODEL);
  }
  if (await settingReferencesModel([id])) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.LLM.MODEL_REFERENCED);
  }
  await db.delete(llmModelTable).where(eq(llmModelTable.id, id));
}
