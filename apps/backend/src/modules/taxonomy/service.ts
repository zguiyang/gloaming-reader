import { randomUUID } from 'node:crypto';

import { desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';

import {
  category as categoryTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkSource as readingWorkSourceTable,
  readingWorkTag as readingWorkTagTable,
  source as sourceTable,
  tag as tagTable,
} from '@gloaming/db';
import type { Locale } from '@gloaming/i18n';
import type {
  CreateTaxonomyBody,
  LanguageCode,
  LocalizedTextMap,
  SourceItem,
  TaxonomyItemResult,
  TaxonomyKind,
  TaxonomyListQuery,
  UpdateTaxonomyBody,
} from '@gloaming/shared/taxonomy';
import { LANGUAGE_CODES, mergeLocalizedText, resolveLocalizedText } from '@gloaming/shared/taxonomy';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError, NotFoundError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { normalizeTag } from '@/lib/text';

const CANONICAL_LOCALE: LanguageCode = 'en-US';

function taxonomyNotFoundCode(kind: TaxonomyKind) {
  if (kind === 'tag') return ERROR_CODES.NOT_FOUND.TAXONOMY_TAG;
  if (kind === 'category') return ERROR_CODES.NOT_FOUND.TAXONOMY_CATEGORY;
  return ERROR_CODES.NOT_FOUND.TAXONOMY_SOURCE;
}

function taxonomyNameExistsCode(kind: TaxonomyKind) {
  if (kind === 'tag') return ERROR_CODES.TAXONOMY.TAG_NAME_EXISTS;
  if (kind === 'category') return ERROR_CODES.TAXONOMY.CATEGORY_NAME_EXISTS;
  return ERROR_CODES.TAXONOMY.SOURCE_NAME_EXISTS;
}

function taxonomyNameConflictCode(kind: TaxonomyKind) {
  if (kind === 'tag') return ERROR_CODES.TAXONOMY.TAG_NAME_CONFLICT;
  if (kind === 'category') return ERROR_CODES.TAXONOMY.CATEGORY_NAME_CONFLICT;
  return ERROR_CODES.TAXONOMY.SOURCE_NAME_CONFLICT;
}

function taxonomyInUseCode(kind: TaxonomyKind) {
  if (kind === 'tag') return ERROR_CODES.TAXONOMY.TAG_IN_USE;
  if (kind === 'category') return ERROR_CODES.TAXONOMY.CATEGORY_IN_USE;
  return ERROR_CODES.TAXONOMY.SOURCE_IN_USE;
}

/**
 * Per-kind adapter — tag/category/source share the same CRUD shape but differ
 * in column names (tag_id/category_id/source_id, normalized vs match_rule).
 * Centralizes those differences so list/delete/cleanup stay generic.
 */
type DimensionAdapter = {
  table: AnyPgTable;
  link: AnyPgTable;
  linkKey: AnyPgColumn;
  /** Search target: normalized (tag/category) or name (source). */
  searchColumn: AnyPgColumn;
  idColumn: AnyPgColumn;
  nameColumn: AnyPgColumn;
  localizedNamesColumn?: AnyPgColumn;
  originColumn: AnyPgColumn;
  createdAtColumn: AnyPgColumn;
  updatedAtColumn: AnyPgColumn;
};

function adapter(kind: TaxonomyKind): DimensionAdapter {
  switch (kind) {
    case 'tag':
      return {
        table: tagTable,
        link: readingWorkTagTable,
        linkKey: readingWorkTagTable.tagId,
        searchColumn: tagTable.normalized,
        idColumn: tagTable.id,
        nameColumn: tagTable.name,
        localizedNamesColumn: tagTable.localizedNames,
        originColumn: tagTable.origin,
        createdAtColumn: tagTable.createdAt,
        updatedAtColumn: tagTable.updatedAt,
      };
    case 'category':
      return {
        table: categoryTable,
        link: readingWorkCategoryTable,
        linkKey: readingWorkCategoryTable.categoryId,
        searchColumn: categoryTable.normalized,
        idColumn: categoryTable.id,
        nameColumn: categoryTable.name,
        localizedNamesColumn: categoryTable.localizedNames,
        originColumn: categoryTable.origin,
        createdAtColumn: categoryTable.createdAt,
        updatedAtColumn: categoryTable.updatedAt,
      };
    case 'source':
      return {
        table: sourceTable,
        link: readingWorkSourceTable,
        linkKey: readingWorkSourceTable.sourceId,
        searchColumn: sourceTable.name,
        idColumn: sourceTable.id,
        nameColumn: sourceTable.name,
        originColumn: sourceTable.origin,
        createdAtColumn: sourceTable.createdAt,
        updatedAtColumn: sourceTable.updatedAt,
      };
  }
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = (error as { code?: string; cause?: { code?: string } }).cause ?? (error as { code?: string });
  return candidate.code === '23505';
}

/** Trim and keep only supported locale keys from request bodies. */
function normalizeNamesInput(names: LocalizedTextMap): LocalizedTextMap {
  const result: LocalizedTextMap = {};
  for (const code of LANGUAGE_CODES) {
    const value = names[code]?.trim();
    if (value) result[code] = value;
  }
  return result;
}

/** Apply only submitted locale labels while retaining other stored labels. */
function mergeNames(existing: LocalizedTextMap | null | undefined, incoming: LocalizedTextMap): LocalizedTextMap {
  let merged = existing ?? {};
  for (const code of LANGUAGE_CODES) {
    const value = incoming[code];
    if (value) {
      merged = mergeLocalizedText(merged, code, value);
    }
  }
  return merged;
}

/** Canonical DB label for uniqueness/search — prefers en-US, then zh-CN. */
function canonicalTaxonomyName(names: LocalizedTextMap, legacyName?: string): string {
  const resolved = resolveLocalizedText(names, CANONICAL_LOCALE);
  if (resolved) return resolved;
  return legacyName?.trim() ?? '';
}

/** Return all stored locale labels without request-locale filtering. */
function buildNamesPayload(localizedNames: LocalizedTextMap | null | undefined, legacyName: string): LocalizedTextMap {
  const payload: LocalizedTextMap = {};
  for (const code of LANGUAGE_CODES) {
    const value = localizedNames?.[code]?.trim();
    if (value) payload[code] = value;
  }
  if (!LANGUAGE_CODES.some((code) => payload[code])) {
    const fallback = legacyName.trim();
    if (fallback) payload[CANONICAL_LOCALE] = fallback;
  }
  return payload;
}

function toItem(
  kind: TaxonomyKind,
  row: {
    id: string;
    name: string;
    localizedNames?: LocalizedTextMap | null;
    origin: 'extracted' | 'ai' | 'manual';
    createdAt: Date;
    updatedAt: Date;
    matchRule?: string | null;
  },
  _locale: Locale,
  usage = 0,
): TaxonomyItemResult {
  if (kind === 'source') {
    return {
      id: row.id,
      name: row.name,
      usage,
      origin: row.origin,
      matchRule: row.matchRule ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } satisfies SourceItem;
  }
  const names = buildNamesPayload(row.localizedNames, row.name);
  return {
    id: row.id,
    names,
    usage,
    origin: row.origin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const MAX_ROWS = 500;

export async function listTaxonomy(
  kind: TaxonomyKind,
  query: TaxonomyListQuery,
  locale: Locale,
): Promise<TaxonomyItemResult[]> {
  const a = adapter(kind);
  const search = query.search?.trim();
  const needle = search ? (kind === 'source' ? search : normalizeTag(search)) : undefined;

  const base = {
    id: a.idColumn,
    name: a.nameColumn,
    origin: a.originColumn,
    usage: sql<number>`count(${a.linkKey})::int`,
    createdAt: a.createdAtColumn,
    updatedAt: a.updatedAtColumn,
  };
  const selectShape =
    kind === 'source'
      ? { ...base, matchRule: sourceTable.matchRule }
      : { ...base, localizedNames: a.localizedNamesColumn! };

  const rows = await db
    .select(selectShape)
    .from(a.table)
    .leftJoin(a.link, eq(a.linkKey, a.idColumn))
    .where(needle ? ilike(a.searchColumn, `%${needle}%`) : undefined)
    .groupBy(a.idColumn, kind === 'source' ? sourceTable.matchRule : a.idColumn)
    .orderBy(desc(sql`count(${a.linkKey})`), a.nameColumn)
    .limit(MAX_ROWS);

  return rows.map((row) => toItem(kind, row as Parameters<typeof toItem>[1], locale, Number(row.usage)));
}

export async function createTaxonomyItem(
  kind: TaxonomyKind,
  body: CreateTaxonomyBody,
  locale: Locale,
): Promise<TaxonomyItemResult> {
  let name = '';
  try {
    if (kind === 'source') {
      if (!('name' in body)) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_INVALID_INPUT);
      }
      name = 'name' in body ? body.name : '';
      const [row] = await db
        .insert(sourceTable)
        .values({ id: randomUUID(), name, matchRule: body.matchRule ?? '', origin: 'manual' })
        .returning();
      return toItem(kind, row, locale);
    }
    if (!('names' in body)) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_INVALID_INPUT);
    }
    const localizedNames = normalizeNamesInput('names' in body ? body.names : {});
    name = canonicalTaxonomyName(localizedNames);
    const table = kind === 'tag' ? tagTable : categoryTable;
    const [row] = await db
      .insert(table as typeof tagTable)
      .values({ id: randomUUID(), name, localizedNames, normalized: normalizeTag(name), origin: 'manual' })
      .returning();
    return toItem(kind, row, locale);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(HTTP_STATUS.CONFLICT, taxonomyNameExistsCode(kind), { name });
    }
    throw error;
  }
}

export async function updateTaxonomyItem(
  kind: TaxonomyKind,
  id: string,
  body: UpdateTaxonomyBody,
  locale: Locale,
): Promise<TaxonomyItemResult> {
  try {
    if (kind === 'source') {
      if ('names' in body) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_INVALID_INPUT);
      }
      let name: string | undefined;
      if ('name' in body && body.name !== undefined) {
        name = body.name.trim();
      }
      const [row] = await db
        .update(sourceTable)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(body.matchRule !== undefined ? { matchRule: body.matchRule.trim() } : {}),
        })
        .where(eq(sourceTable.id, id))
        .returning();
      if (!row) throw new NotFoundError(taxonomyNotFoundCode(kind));
      return toItem(kind, row, locale);
    }
    const table = kind === 'tag' ? tagTable : categoryTable;
    let localizedNames: LocalizedTextMap | undefined;
    let name: string | undefined;
    if ('names' in body && body.names !== undefined) {
      const [current] = await db
        .select({ name: (table as typeof tagTable).name, localizedNames: (table as typeof tagTable).localizedNames })
        .from(table as typeof tagTable)
        .where(eq((table as typeof tagTable).id, id))
        .limit(1);
      if (!current) throw new NotFoundError(taxonomyNotFoundCode(kind));
      localizedNames = mergeNames(current.localizedNames, normalizeNamesInput(body.names));
      name = canonicalTaxonomyName(localizedNames, current.name);
    }
    const [row] = await db
      .update(table as typeof tagTable)
      .set(name !== undefined ? { name, localizedNames, normalized: normalizeTag(name) } : {})
      .where(eq((table as typeof tagTable).id, id))
      .returning();
    if (!row) throw new NotFoundError(taxonomyNotFoundCode(kind));
    return toItem(kind, row, locale);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (isUniqueViolation(error)) {
      throw new AppError(HTTP_STATUS.CONFLICT, taxonomyNameConflictCode(kind));
    }
    throw error;
  }
}

export async function deleteTaxonomyItem(kind: TaxonomyKind, id: string): Promise<void> {
  if (kind === 'source') {
    throw new AppError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.TAXONOMY.SOURCE_DELETE_FORBIDDEN);
  }
  const a = adapter(kind);
  const [existing] = await db.select({ id: a.idColumn }).from(a.table).where(eq(a.idColumn, id)).limit(1);
  if (!existing) throw new NotFoundError(taxonomyNotFoundCode(kind));
  const [{ usage }] = await db
    .select({ usage: sql<number>`count(${a.linkKey})::int` })
    .from(a.link)
    .where(eq(a.linkKey, id));
  if (usage > 0) {
    throw new AppError(HTTP_STATUS.CONFLICT, taxonomyInUseCode(kind), { usage });
  }
  await db.delete(a.table).where(eq(a.idColumn, id));
}

/** Prune unreferenced rows (usage = 0) for tag/category — sources never delete. */
export async function cleanupUnusedTaxonomy(kind: 'tag' | 'category'): Promise<number> {
  const a = adapter(kind);
  const unused = await db
    .select({ id: a.idColumn })
    .from(a.table)
    .leftJoin(a.link, eq(a.linkKey, a.idColumn))
    .groupBy(a.idColumn)
    .having(sql`count(${a.linkKey}) = 0`);
  if (unused.length === 0) return 0;
  await db.delete(a.table).where(
    inArray(
      a.idColumn,
      unused.map((row) => row.id),
    ),
  );
  return unused.length;
}
