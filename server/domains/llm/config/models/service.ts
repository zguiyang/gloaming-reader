import { and, asc, eq, isNull } from 'drizzle-orm';

import { llmModel as llmModelTable, llmProvider as llmProviderTable } from '@/server/db';
import { type CreateLlmModelBody, type LlmModel, type LlmModelListQuery, type UpdateLlmModelBody } from '@/shared/llm';

import { parseApiFamily } from '@/server/domains/llm/config/api-family';
import { toModelView } from '@/server/domains/llm/config/mappers';
import { createModelRecord, deleteModelRecord, updateModelRecord } from '@/server/domains/llm/config/mutations';
import { requireInstanceProvider } from '@/server/domains/provider-scope';
import { db } from '@/server/infra/db';
import { NotFoundError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

export async function listModels(query: LlmModelListQuery): Promise<LlmModel[]> {
  if (query.providerId) {
    await requireInstanceProvider(query.providerId);
  }
  const rows = query.providerId
    ? await db
        .select({ model: llmModelTable })
        .from(llmModelTable)
        .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
        .where(and(eq(llmModelTable.providerId, query.providerId), isNull(llmProviderTable.ownerUserId)))
        .orderBy(asc(llmModelTable.sortOrder), asc(llmModelTable.createdAt))
    : await db
        .select({ model: llmModelTable })
        .from(llmModelTable)
        .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
        .where(isNull(llmProviderTable.ownerUserId))
        .orderBy(asc(llmModelTable.sortOrder), asc(llmModelTable.createdAt));
  return rows.map((row) => toModelView(row.model));
}

export async function createModel(body: CreateLlmModelBody): Promise<LlmModel> {
  const providerRow = await requireInstanceProvider(body.providerId);
  return createModelRecord(providerRow, body);
}

export async function updateModel(id: string, body: UpdateLlmModelBody): Promise<LlmModel> {
  const existing = await db
    .select({
      model: llmModelTable,
      apiFamily: llmProviderTable.apiFamily,
    })
    .from(llmModelTable)
    .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
    .where(and(eq(llmModelTable.id, id), isNull(llmProviderTable.ownerUserId)))
    .limit(1);
  if (!existing[0]) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_MODEL);
  }
  return updateModelRecord(id, parseApiFamily(existing[0].apiFamily), body);
}

export async function deleteModel(id: string): Promise<void> {
  const existing = await db
    .select({ id: llmModelTable.id })
    .from(llmModelTable)
    .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
    .where(and(eq(llmModelTable.id, id), isNull(llmProviderTable.ownerUserId)))
    .limit(1);
  if (!existing[0]) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_MODEL);
  }
  await deleteModelRecord(id);
}
