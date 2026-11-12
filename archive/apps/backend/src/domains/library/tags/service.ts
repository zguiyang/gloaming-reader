import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  readingWork as readingWorkTable,
  userLibraryItem as userLibraryItemTable,
  userPersonalTagPreference as userPersonalTagPreferenceTable,
  userTag as userTagTable,
  userWorkTag as userWorkTagTable,
  userWorkTagSuppression as userWorkTagSuppressionTable,
} from '@gloaming/db';
import { type Locale, SUPPORTED_LOCALES } from '@gloaming/i18n';
import type { UserTag, UserTagManagementItem } from '@gloaming/shared/library';

import { invokeAi } from '@/domains/ai';
import { normalizeTagName } from '@/domains/library/tags/normalization';
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

function toUserTag(row: {
  id: string;
  name: string;
  localizedNames: Record<string, string>;
  sourceLocale: string | null;
  userEditedLocales: string[];
  createdBy: 'ai' | 'manual';
}): UserTag {
  return {
    id: row.id,
    name: row.name,
    localizedNames: row.localizedNames ?? {},
    sourceLocale: row.sourceLocale,
    userEditedLocales: row.userEditedLocales ?? [],
    createdBy: row.createdBy ?? 'manual',
  };
}

export async function listUserTags(userId: string): Promise<UserTagManagementItem[]> {
  const rows = await db
    .select({
      id: userTagTable.id,
      name: userTagTable.name,
      localizedNames: userTagTable.localizedNames,
      sourceLocale: userTagTable.sourceLocale,
      userEditedLocales: userTagTable.userEditedLocales,
      createdBy: userTagTable.createdBy,
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

export async function createUserTag(userId: string, rawName: string, locale: Locale): Promise<UserTag> {
  const name = rawName.trim();
  const normalizedName = normalizeTagName(name);
  const [existing] = await db
    .select({ id: userTagTable.id })
    .from(userTagTable)
    .where(and(eq(userTagTable.userId, userId), eq(userTagTable.normalizedName, normalizedName)))
    .limit(1);
  if (existing) throw tagNameExists();

  try {
    const [row] = await db
      .insert(userTagTable)
      .values({
        id: randomUUID(),
        userId,
        name,
        normalizedName,
        sourceLocale: locale,
        localizedNames: { [locale]: name },
        userEditedLocales: [locale],
      })
      .returning({
        id: userTagTable.id,
        name: userTagTable.name,
        localizedNames: userTagTable.localizedNames,
        sourceLocale: userTagTable.sourceLocale,
        userEditedLocales: userTagTable.userEditedLocales,
        createdBy: userTagTable.createdBy,
      });
    return toUserTag(row!);
  } catch (error) {
    if (isUniqueViolation(error)) throw tagNameExists();
    throw error;
  }
}

/** Internal creation path for P2; AI-created names are not marked as user-edited. */
export async function createAiUserTag(userId: string, rawName: string, locale: Locale): Promise<UserTag> {
  const name = rawName.trim();
  const normalizedName = normalizeTagName(name);
  try {
    const [row] = await db
      .insert(userTagTable)
      .values({
        id: randomUUID(),
        userId,
        name,
        normalizedName,
        createdBy: 'ai',
        sourceLocale: locale,
        localizedNames: { [locale]: name },
        userEditedLocales: [],
      })
      .onConflictDoNothing({ target: [userTagTable.userId, userTagTable.normalizedName] })
      .returning({
        id: userTagTable.id,
        name: userTagTable.name,
        localizedNames: userTagTable.localizedNames,
        sourceLocale: userTagTable.sourceLocale,
        userEditedLocales: userTagTable.userEditedLocales,
        createdBy: userTagTable.createdBy,
      });
    if (row) return toUserTag(row);
    const [existing] = await db
      .select({
        id: userTagTable.id,
        name: userTagTable.name,
        localizedNames: userTagTable.localizedNames,
        sourceLocale: userTagTable.sourceLocale,
        userEditedLocales: userTagTable.userEditedLocales,
        createdBy: userTagTable.createdBy,
      })
      .from(userTagTable)
      .where(and(eq(userTagTable.userId, userId), eq(userTagTable.normalizedName, normalizedName)))
      .limit(1);
    if (!existing) throw new Error('Concurrent user tag creation did not resolve');
    return toUserTag(existing);
  } catch (error) {
    if (isUniqueViolation(error)) throw tagNameExists();
    throw error;
  }
}

export async function renameUserTag(userId: string, tagId: string, rawName: string, locale: Locale): Promise<UserTag> {
  const name = rawName.trim();
  const normalizedName = normalizeTagName(name);
  const [owned] = await db
    .select({
      id: userTagTable.id,
      name: userTagTable.name,
      sourceLocale: userTagTable.sourceLocale,
      localizedNames: userTagTable.localizedNames,
    })
    .from(userTagTable)
    .where(and(eq(userTagTable.id, tagId), eq(userTagTable.userId, userId)))
    .limit(1);
  if (!owned) throw new NotFoundError(ERROR_CODES.NOT_FOUND.USER_TAG);

  const updatesPrimaryName = owned.sourceLocale === locale || owned.sourceLocale === null;

  if (updatesPrimaryName) {
    const [existing] = await db
      .select({ id: userTagTable.id })
      .from(userTagTable)
      .where(and(eq(userTagTable.userId, userId), eq(userTagTable.normalizedName, normalizedName)))
      .limit(1);
    if (existing && existing.id !== tagId) throw tagNameExists();
  }

  try {
    const sourceNameChanged = owned.sourceLocale === locale && (owned.localizedNames[locale] ?? owned.name) !== name;
    const localizedNamesToUpdate = sourceNameChanged
      ? sql<Record<string, string>>`COALESCE(
          (
            SELECT jsonb_object_agg(localized_entry.key, localized_entry.value)
            FROM jsonb_each(${userTagTable.localizedNames}) AS localized_entry
            WHERE localized_entry.key = ${locale}
              OR ${userTagTable.userEditedLocales} @> ARRAY[localized_entry.key]::text[]
          ),
          '{}'::jsonb
        )`
      : userTagTable.localizedNames;
    const localizedNames = sql<Record<string, string>>`jsonb_set(
      ${localizedNamesToUpdate}, ARRAY[${locale}], to_jsonb(${name}::text), true
    )`;
    const userEditedLocales = sql<string[]>`array_append(
      array_remove(${userTagTable.userEditedLocales}, ${locale}), ${locale}
    )`;
    const [row] = await db
      .update(userTagTable)
      .set({
        localizedNames,
        userEditedLocales,
        ...(updatesPrimaryName ? { name, normalizedName, sourceLocale: locale } : {}),
      })
      .where(and(eq(userTagTable.id, tagId), eq(userTagTable.userId, userId)))
      .returning({
        id: userTagTable.id,
        name: userTagTable.name,
        localizedNames: userTagTable.localizedNames,
        sourceLocale: userTagTable.sourceLocale,
        userEditedLocales: userTagTable.userEditedLocales,
        createdBy: userTagTable.createdBy,
      });
    if (!row) throw new NotFoundError(ERROR_CODES.NOT_FOUND.USER_TAG);
    return toUserTag(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw tagNameExists();
    throw error;
  }
}

const translationOutputSchema = z.object({
  translations: z.array(z.object({ locale: z.string(), name: z.string() })),
});

function validTranslationName(value: string): string | null {
  const name = value.trim();
  if (!name || name.length > 80 || /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(name)) return null;
  return name;
}

async function getOwnedTag(userId: string, tagId: string) {
  const [row] = await db
    .select({
      id: userTagTable.id,
      userId: userTagTable.userId,
      name: userTagTable.name,
      sourceLocale: userTagTable.sourceLocale,
      localizedNames: userTagTable.localizedNames,
      userEditedLocales: userTagTable.userEditedLocales,
      createdBy: userTagTable.createdBy,
    })
    .from(userTagTable)
    .where(and(eq(userTagTable.id, tagId), eq(userTagTable.userId, userId)))
    .limit(1);
  return row;
}

/** Whether the current preference still authorizes writes for one captured generation. */
async function preferenceAuthorizesGeneration(userId: string, generation: number): Promise<boolean> {
  const [preference] = await db
    .select({
      enabled: userPersonalTagPreferenceTable.enabled,
      generation: userPersonalTagPreferenceTable.generation,
    })
    .from(userPersonalTagPreferenceTable)
    .where(eq(userPersonalTagPreferenceTable.userId, userId))
    .limit(1);
  return Boolean(preference?.enabled && preference.generation === generation);
}

/** Fill only missing locale keys. The conditional update protects edits made while AI is running. */
export async function completeUserTagTranslations(
  userId: string,
  tagId: string,
  options: {
    source?: string;
    providerScope?: 'user-first' | 'user-only';
    maxTokens?: number;
    maxRetries?: number;
    authorizationGeneration?: number;
  } = {},
): Promise<{ tag: UserTag; status: 'completed' | 'incomplete' | 'provider_unavailable' }> {
  const initial = await getOwnedTag(userId, tagId);
  if (!initial) throw new NotFoundError(ERROR_CODES.NOT_FOUND.USER_TAG);

  const sourceLocale = initial.sourceLocale;
  if (!sourceLocale || !SUPPORTED_LOCALES.some((locale) => locale === sourceLocale)) {
    return { tag: toUserTag(initial), status: 'incomplete' };
  }
  const sourceName = initial.localizedNames[sourceLocale] ?? initial.name;

  const targets = SUPPORTED_LOCALES.filter(
    (locale) =>
      locale !== sourceLocale && !initial.localizedNames[locale] && !initial.userEditedLocales.includes(locale),
  );
  if (targets.length === 0) return { tag: toUserTag(initial), status: 'completed' };
  if (
    options.authorizationGeneration !== undefined &&
    !(await preferenceAuthorizesGeneration(userId, options.authorizationGeneration))
  ) {
    return { tag: toUserTag(initial), status: 'incomplete' };
  }

  let translations: Array<{ locale: string; name: string }>;
  try {
    const response = await invokeAi({
      purpose: 'translate',
      source: options.source ?? 'user-tag.translation',
      userId,
      providerScope: options.providerScope,
      maxTokens: options.maxTokens,
      maxRetries: options.maxRetries,
      ref: { type: 'user_tag', id: tagId },
      timeoutMs: 15_000,
      messages: [
        {
          role: 'system',
          content:
            'Translate the user-provided tag label faithfully. Return one natural label for each requested target locale. Do not add concepts, explanations, or source-language text as a target translation. Preserve meaningful punctuation and product names.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            sourceLocale,
            sourceName,
            targetLocales: targets,
          }),
        },
      ],
      outputSchema: translationOutputSchema,
    });
    translations = response.content.translations;
  } catch (error) {
    const providerUnavailable =
      error instanceof AppError &&
      (error.code === ERROR_CODES.AI.MODEL_NOT_CONFIGURED || error.code === ERROR_CODES.AI.UNAVAILABLE);
    const current = await getOwnedTag(userId, tagId);
    if (!current) throw new NotFoundError(ERROR_CODES.NOT_FOUND.USER_TAG);
    return { tag: toUserTag(current), status: providerUnavailable ? 'provider_unavailable' : 'incomplete' };
  }

  for (const candidate of translations) {
    if (!targets.some((locale) => locale === candidate.locale)) continue;
    const name = validTranslationName(candidate.name);
    if (!name) continue;

    const saveTranslation = async (executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      await executor
        .update(userTagTable)
        .set({
          localizedNames: sql<Record<string, string>>`jsonb_set(
            ${userTagTable.localizedNames}, ARRAY[${candidate.locale}], to_jsonb(${name}::text), true
          )`,
        })
        .where(
          and(
            eq(userTagTable.id, tagId),
            eq(userTagTable.userId, userId),
            eq(userTagTable.sourceLocale, sourceLocale),
            sql`COALESCE(${userTagTable.localizedNames}->>${sourceLocale}, ${userTagTable.name}) = ${sourceName}`,
            sql`NOT (${userTagTable.localizedNames} ? ${candidate.locale})`,
            sql`NOT (${userTagTable.userEditedLocales} @> ARRAY[${candidate.locale}]::text[])`,
          ),
        );
    };
    if (options.authorizationGeneration === undefined) {
      await saveTranslation(db);
    } else {
      await db.transaction(async (tx) => {
        const [preference] = await tx
          .select({
            enabled: userPersonalTagPreferenceTable.enabled,
            generation: userPersonalTagPreferenceTable.generation,
          })
          .from(userPersonalTagPreferenceTable)
          .where(eq(userPersonalTagPreferenceTable.userId, userId))
          .for('update')
          .limit(1);
        if (preference?.enabled && preference.generation === options.authorizationGeneration) {
          await saveTranslation(tx);
        }
      });
    }
  }

  const current = await getOwnedTag(userId, tagId);
  if (!current) throw new NotFoundError(ERROR_CODES.NOT_FOUND.USER_TAG);
  const stillMissing = SUPPORTED_LOCALES.some((locale) => !current.localizedNames[locale]);
  return { tag: toUserTag(current), status: stillMissing ? 'incomplete' : 'completed' };
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
  lockMode: 'share' | 'update' = 'share',
): Promise<void> {
  const workQuery = tx
    .select({ id: readingWorkTable.id, ownerUserId: readingWorkTable.ownerUserId })
    .from(readingWorkTable)
    .where(eq(readingWorkTable.id, workId));
  const [work] = await (lockMode === 'update' ? workQuery.for('update') : workQuery.for('share')).limit(1);
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
    await requireManageableWork(tx, userId, workId, 'update');
    const [ownedTag] = await tx
      .select({ id: userTagTable.id })
      .from(userTagTable)
      .where(and(eq(userTagTable.id, tagId), eq(userTagTable.userId, userId)))
      .limit(1);
    if (!ownedTag) throw new NotFoundError(ERROR_CODES.NOT_FOUND.USER_TAG);
    await tx
      .delete(userWorkTagSuppressionTable)
      .where(
        and(
          eq(userWorkTagSuppressionTable.userId, userId),
          eq(userWorkTagSuppressionTable.workId, workId),
          eq(userWorkTagSuppressionTable.tagId, tagId),
        ),
      );
    await tx
      .insert(userWorkTagTable)
      .values({ userId, workId, tagId, source: 'manual' })
      .onConflictDoUpdate({
        target: [userWorkTagTable.userId, userWorkTagTable.workId, userWorkTagTable.tagId],
        set: { source: 'manual' },
      });
  });
}

export async function unassignUserTag(userId: string, workId: string, tagId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await requireManageableWork(tx, userId, workId, 'update');
    await tx
      .insert(userWorkTagSuppressionTable)
      .values({ userId, workId, tagId })
      .onConflictDoUpdate({
        target: [
          userWorkTagSuppressionTable.userId,
          userWorkTagSuppressionTable.workId,
          userWorkTagSuppressionTable.tagId,
        ],
        set: { removedAt: new Date() },
      });
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
    .select({
      workId: userWorkTagTable.workId,
      id: userTagTable.id,
      name: userTagTable.name,
      localizedNames: userTagTable.localizedNames,
      sourceLocale: userTagTable.sourceLocale,
      userEditedLocales: userTagTable.userEditedLocales,
      createdBy: userTagTable.createdBy,
    })
    .from(userWorkTagTable)
    .innerJoin(userTagTable, and(eq(userTagTable.id, userWorkTagTable.tagId), eq(userTagTable.userId, userId)))
    .where(and(eq(userWorkTagTable.userId, userId), inArray(userWorkTagTable.workId, workIds)))
    .orderBy(sql`lower(${userTagTable.name})`, userTagTable.name);
  const result = new Map<string, UserTag[]>();
  for (const row of rows) {
    const tags = result.get(row.workId) ?? [];
    tags.push(toUserTag(row));
    result.set(row.workId, tags);
  }
  return result;
}
