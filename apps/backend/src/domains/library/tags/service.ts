import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  readingWork as readingWorkTable,
  userLibraryItem as userLibraryItemTable,
  userTag as userTagTable,
  userWorkTag as userWorkTagTable,
} from '@gloaming/db';
import type { UserTag, UserTagManagementItem } from '@gloaming/shared/library';

import { normalizeTag } from '@/domains/taxonomy/normalization';
import { db } from '@/infra/db';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError, NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

function tagNameExists(): AppError {
  return new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.LIBRARY.USER_TAG_NAME_EXISTS);
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return (
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    error.cause.code === '23505'
  );
}

function toUserTag(row: { id: string; name: string }): UserTag {
  return { id: row.id, name: row.name };
}

export async function listUserTags(userId: string): Promise<UserTagManagementItem[]> {
  const rows = await db
    .select({
      id: userTagTable.id,
      name: userTagTable.name,
      bookCount: sql<number>`count(${userWorkTagTable.workId})::int`,
    })
    .from(userTagTable)
    .leftJoin(
      userWorkTagTable,
      and(eq(userWorkTagTable.userId, userTagTable.userId), eq(userWorkTagTable.tagId, userTagTable.id)),
    )
    .where(eq(userTagTable.userId, userId))
    .groupBy(userTagTable.id)
    .orderBy(sql`lower(${userTagTable.name})`, userTagTable.name);
  return rows.map((row) => ({ ...row, bookCount: Number(row.bookCount) }));
}

export async function createUserTag(userId: string, rawName: string): Promise<UserTag> {
  const name = rawName.trim();
  const normalizedName = normalizeTag(name);
  const [existing] = await db
    .select({ id: userTagTable.id })
    .from(userTagTable)
    .where(and(eq(userTagTable.userId, userId), eq(userTagTable.normalizedName, normalizedName)))
    .limit(1);
  if (existing) throw tagNameExists();

  try {
    const [row] = await db
      .insert(userTagTable)
      .values({ id: randomUUID(), userId, name, normalizedName })
      .returning({ id: userTagTable.id, name: userTagTable.name });
    return toUserTag(row!);
  } catch (error) {
    if (isUniqueViolation(error)) throw tagNameExists();
    throw error;
  }
}

export async function renameUserTag(userId: string, tagId: string, rawName: string): Promise<UserTag> {
  const name = rawName.trim();
  const normalizedName = normalizeTag(name);
  const [owned] = await db
    .select({ id: userTagTable.id })
    .from(userTagTable)
    .where(and(eq(userTagTable.id, tagId), eq(userTagTable.userId, userId)))
    .limit(1);
  if (!owned) throw new NotFoundError(ERROR_CODES.NOT_FOUND.USER_TAG);

  const [existing] = await db
    .select({ id: userTagTable.id })
    .from(userTagTable)
    .where(and(eq(userTagTable.userId, userId), eq(userTagTable.normalizedName, normalizedName)))
    .limit(1);
  if (existing && existing.id !== tagId) throw tagNameExists();

  try {
    const [row] = await db
      .update(userTagTable)
      .set({ name, normalizedName })
      .where(and(eq(userTagTable.id, tagId), eq(userTagTable.userId, userId)))
      .returning({ id: userTagTable.id, name: userTagTable.name });
    if (!row) throw new NotFoundError(ERROR_CODES.NOT_FOUND.USER_TAG);
    return toUserTag(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw tagNameExists();
    throw error;
  }
}

export async function deleteUserTag(userId: string, tagId: string): Promise<void> {
  const deleted = await db
    .delete(userTagTable)
    .where(and(eq(userTagTable.id, tagId), eq(userTagTable.userId, userId)))
    .returning({ id: userTagTable.id });
  if (deleted.length === 0) throw new NotFoundError(ERROR_CODES.NOT_FOUND.USER_TAG);
}

async function requireManageableWork(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  workId: string,
): Promise<void> {
  const [work] = await tx
    .select({ id: readingWorkTable.id, ownerUserId: readingWorkTable.ownerUserId })
    .from(readingWorkTable)
    .where(eq(readingWorkTable.id, workId))
    .for('share')
    .limit(1);
  if (!work) throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  if (work.ownerUserId === userId) return;
  if (work.ownerUserId !== null) throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);

  const [membership] = await tx
    .select({ workId: userLibraryItemTable.workId })
    .from(userLibraryItemTable)
    .innerJoin(readingWorkTable, eq(userLibraryItemTable.workId, readingWorkTable.id))
    .where(
      and(
        eq(userLibraryItemTable.userId, userId),
        eq(userLibraryItemTable.workId, workId),
        isNull(readingWorkTable.ownerUserId),
        eq(readingWorkTable.visibility, 'catalog'),
        sql`${readingWorkTable.publishedAt} IS NOT NULL`,
      ),
    )
    .for('share')
    .limit(1);
  if (!membership) throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
}

export async function assignUserTag(userId: string, workId: string, tagId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await requireManageableWork(tx, userId, workId);
    const [ownedTag] = await tx
      .select({ id: userTagTable.id })
      .from(userTagTable)
      .where(and(eq(userTagTable.id, tagId), eq(userTagTable.userId, userId)))
      .limit(1);
    if (!ownedTag) throw new NotFoundError(ERROR_CODES.NOT_FOUND.USER_TAG);
    await tx
      .insert(userWorkTagTable)
      .values({ userId, workId, tagId })
      .onConflictDoNothing({
        target: [userWorkTagTable.userId, userWorkTagTable.workId, userWorkTagTable.tagId],
      });
  });
}

export async function unassignUserTag(userId: string, workId: string, tagId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await requireManageableWork(tx, userId, workId);
    await tx
      .delete(userWorkTagTable)
      .where(
        and(
          eq(userWorkTagTable.userId, userId),
          eq(userWorkTagTable.workId, workId),
          eq(userWorkTagTable.tagId, tagId),
        ),
      );
  });
}

export async function loadUserTagsByWorkIds(userId: string, workIds: string[]): Promise<Map<string, UserTag[]>> {
  if (workIds.length === 0) return new Map();
  const rows = await db
    .select({ workId: userWorkTagTable.workId, id: userTagTable.id, name: userTagTable.name })
    .from(userWorkTagTable)
    .innerJoin(userTagTable, and(eq(userTagTable.id, userWorkTagTable.tagId), eq(userTagTable.userId, userId)))
    .where(and(eq(userWorkTagTable.userId, userId), inArray(userWorkTagTable.workId, workIds)))
    .orderBy(sql`lower(${userTagTable.name})`, userTagTable.name);
  const result = new Map<string, UserTag[]>();
  for (const row of rows) {
    const tags = result.get(row.workId) ?? [];
    tags.push({ id: row.id, name: row.name });
    result.set(row.workId, tags);
  }
  return result;
}
