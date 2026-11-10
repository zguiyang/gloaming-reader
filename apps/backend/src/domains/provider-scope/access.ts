import { and, eq, isNull } from 'drizzle-orm';

import { llmModel as llmModelTable, llmProvider as llmProviderTable } from '@gloaming/db';

import type { ProviderRuntimeActor } from '@/domains/provider-scope/types';
import { db } from '@/infra/db';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError, NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

type ProviderRow = typeof llmProviderTable.$inferSelect;

export function isProviderAccessibleForActor(
  provider: Pick<ProviderRow, 'ownerUserId'>,
  actor: ProviderRuntimeActor,
): boolean {
  if (provider.ownerUserId == null) {
    return true;
  }
  return actor.kind === 'authenticated' && provider.ownerUserId === actor.userId;
}

export async function assertModelAccessibleForActor(modelRowId: string, actor: ProviderRuntimeActor): Promise<void> {
  const rows = await db
    .select({ ownerUserId: llmProviderTable.ownerUserId })
    .from(llmModelTable)
    .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
    .where(eq(llmModelTable.id, modelRowId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_MODEL);
  }
  if (!isProviderAccessibleForActor(row, actor)) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_MODEL);
  }
}

export async function requireInstanceProvider(providerId: string): Promise<ProviderRow> {
  const rows = await db
    .select()
    .from(llmProviderTable)
    .where(and(eq(llmProviderTable.id, providerId), isNull(llmProviderTable.ownerUserId)))
    .limit(1);
  if (!rows[0]) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_PROVIDER);
  }
  return rows[0];
}

export async function requireUserOwnedProvider(providerId: string, userId: string): Promise<ProviderRow> {
  const rows = await db
    .select()
    .from(llmProviderTable)
    .where(and(eq(llmProviderTable.id, providerId), eq(llmProviderTable.ownerUserId, userId)))
    .limit(1);
  if (!rows[0]) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.LLM_PROVIDER);
  }
  return rows[0];
}

/** Reject request bodies that try to smuggle scope ownership. */
export function rejectOwnerUserIdInPayload(body: Record<string, unknown>): void {
  if ('ownerUserId' in body || 'owner_user_id' in body) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_FAILED);
  }
}
