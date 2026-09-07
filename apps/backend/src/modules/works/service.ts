import { randomUUID } from 'node:crypto';

import { and, asc, count, desc, eq, exists, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';

import {
  category as categoryTable,
  contentAsset as contentAssetTable,
  conversation as conversationTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkSource as readingWorkSourceTable,
  readingWorkTag as readingWorkTagTable,
  source as sourceTable,
  tag as tagTable,
  type WorkMetadataProvenance,
  type WorkMetadataProvenanceMap,
} from '@gloaming/db';
import {
  type AdminOriginAsset,
  type AdminWork,
  type AdminWorkListData,
  type AdminWorkListQuery,
  type AdminWorkSummary,
  type CatalogListData,
  type CatalogListQuery,
  type CreateAdminTextWorkBody,
  type CreateEpubWorkResult,
  EPUB_UPLOAD_MAX_BYTES,
  getPublishWorkIssues,
  type Part,
  type RetryWorkflowBody,
  type UpdateWorkBody,
  type Work,
  WORKFLOW_STEPS,
  type WorkflowStep,
} from '@gloaming/shared';
import { buildPaginationMeta } from '@gloaming/shared/pagination';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { JOB_CONTENT_PARSE } from '@/jobs/content-parse';
import { JOB_METADATA_FILL } from '@/jobs/work-metadata-fill';
import { AppError, NotFoundError, ValidationFailedError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { normalizeTag } from '@/lib/text';
import {
  completeWorkflowStep,
  failWorkflowEnqueue,
  prepareWorkflowEnqueue,
  stepRunningStatus,
  workflowLeaseExpiresAt,
} from '@/lib/workflow';
import { getWorkflowPolicyProjection, TTS_STEP_ENABLED, WORKFLOW_AUTO_CHAIN } from '@/lib/workflow-policy';
import { getWorksDerivedFreshness } from '@/modules/derived-freshness';
import { deleteObject } from '@/modules/oss';
import { computePartReadingStats, computeWorkReadingStats } from '@/modules/reading-stats/service';
import { deleteBilingualCacheForPart } from '@/modules/translate/service';
import {
  acquireUploadedObject,
  fileExtension,
  isValidContentHash,
  isZipFile,
  releaseUploadedObject,
  type UploadedFileMeta,
  type UploadSpec,
} from '@/modules/uploads/service';

type WorkRow = typeof readingWorkTable.$inferSelect;
type PartRow = typeof readingPartTable.$inferSelect;

const workLogger = rootLogger.child({ module: 'Works' });

function toIso(value: Date): string {
  return value.toISOString();
}

/** admin_epub re-parse: hide tags in API projection (junction rows are preserved). */
function shouldHideTagsDuringProcessing(row: WorkRow): boolean {
  return row.originKind === 'admin_epub' && row.status === 'processing';
}

function resolveTagProvenance(provenances: WorkMetadataProvenance[]): WorkMetadataProvenance | undefined {
  if (provenances.some((p) => p === 'manual')) return 'manual';
  if (provenances.some((p) => p === 'ai')) return 'ai';
  if (provenances.some((p) => p === 'extracted')) return 'extracted';
  return undefined;
}

/** Tag names for one work — junction SSOT. */
export async function loadTagsForWork(workId: string): Promise<string[]> {
  const rows = await db
    .select({ name: tagTable.name })
    .from(readingWorkTagTable)
    .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
    .where(eq(readingWorkTagTable.workId, workId))
    .orderBy(asc(tagTable.name));
  return rows.map((row) => row.name);
}

/** Batch tag names keyed by work id. */
export async function loadTagsByWorkIds(workIds: string[]): Promise<Map<string, string[]>> {
  if (workIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ workId: readingWorkTagTable.workId, name: tagTable.name })
    .from(readingWorkTagTable)
    .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
    .where(inArray(readingWorkTagTable.workId, workIds))
    .orderBy(asc(tagTable.name));
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.workId) ?? [];
    list.push(row.name);
    map.set(row.workId, list);
  }
  return map;
}

async function loadTagProvenanceForWork(workId: string): Promise<WorkMetadataProvenance | undefined> {
  const rows = await db
    .select({ provenance: readingWorkTagTable.provenance })
    .from(readingWorkTagTable)
    .where(eq(readingWorkTagTable.workId, workId));
  return resolveTagProvenance(rows.map((row) => row.provenance));
}

async function loadCategoryProvenanceForWork(workId: string): Promise<WorkMetadataProvenance | undefined> {
  const [row] = await db
    .select({ provenance: readingWorkCategoryTable.provenance })
    .from(readingWorkCategoryTable)
    .where(eq(readingWorkCategoryTable.workId, workId))
    .limit(1);
  return row?.provenance;
}

/** Runtime admin API projection — not persisted on reading_work. */
function buildMetadataProvenance(
  row: WorkRow,
  junction: { tagProvenance?: WorkMetadataProvenance; categoryProvenance?: WorkMetadataProvenance },
): WorkMetadataProvenanceMap {
  const map: WorkMetadataProvenanceMap = {};
  if (row.descriptionProvenance) {
    map.description = row.descriptionProvenance;
  }
  if (junction.tagProvenance && !shouldHideTagsDuringProcessing(row)) {
    map.tags = junction.tagProvenance;
  }
  if (junction.categoryProvenance) {
    map.category = junction.categoryProvenance;
  }
  return map;
}

/** Backfill stats for works parsed before reading_work stats columns existed. */
async function ensureWorkReadingStatsIfMissing(row: WorkRow): Promise<WorkRow> {
  if (row.wordCount != null) {
    return row;
  }

  const parts = await loadPartsForWork(row.id);
  if (parts.length === 0) {
    return row;
  }

  const preserveManualStats = row.statsProvenance === 'manual';
  const workStats = computeWorkReadingStats(
    parts.map((part) => ({ body: part.body })),
    row.language,
  );

  await db.transaction(async (tx) => {
    for (const part of parts) {
      const meta = part.meta as { wordCount?: unknown };
      if (typeof meta.wordCount === 'number') {
        continue;
      }
      const partStats = computePartReadingStats(part.body);
      await tx
        .update(readingPartTable)
        .set({ meta: { wordCount: partStats.wordCount } })
        .where(eq(readingPartTable.id, part.id));
    }

    await tx
      .update(readingWorkTable)
      .set({
        wordCount: workStats.wordCount,
        estimatedMinutes: workStats.estimatedMinutes,
        ...(preserveManualStats
          ? {}
          : {
              suggestedVocabSize: workStats.suggestedVocabSize,
              difficultyScore: workStats.difficultyScore,
              statsProvenance: workStats.statsProvenance,
            }),
      })
      .where(eq(readingWorkTable.id, row.id));
  });

  const [updated] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, row.id)).limit(1);
  return updated ?? row;
}

function toWork(row: WorkRow, tags: string[], sources: string[]): Work {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    language: row.language,
    status: row.status as Work['status'],
    visibility: row.visibility as Work['visibility'],
    originKind: row.originKind as Work['originKind'],
    tags: shouldHideTagsDuringProcessing(row) ? [] : tags,
    sources,
    coverAssetId: row.coverAssetId,
    wordCount: row.wordCount,
    estimatedMinutes: row.estimatedMinutes,
    suggestedVocabSize: row.suggestedVocabSize,
    difficultyScore: row.difficultyScore,
    statsProvenance: row.statsProvenance,
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toPart(row: PartRow): Part {
  return {
    id: row.id,
    workId: row.workId,
    sortOrder: row.sortOrder,
    kind: row.kind as Part['kind'],
    title: row.title,
    body: row.body,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

async function loadPartsForWork(workId: string): Promise<PartRow[]> {
  return db
    .select()
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId))
    .orderBy(asc(readingPartTable.sortOrder), asc(readingPartTable.id));
}

/** Batch part sort orders for chapter progress on shelf/history surfaces. */
export async function loadPartSortOrdersByWorkIds(workIds: string[]): Promise<Map<string, { sortOrder: number }[]>> {
  if (workIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ workId: readingPartTable.workId, sortOrder: readingPartTable.sortOrder })
    .from(readingPartTable)
    .where(inArray(readingPartTable.workId, workIds))
    .orderBy(asc(readingPartTable.sortOrder), asc(readingPartTable.id));
  const map = new Map<string, { sortOrder: number }[]>();
  for (const row of rows) {
    const list = map.get(row.workId) ?? [];
    list.push({ sortOrder: row.sortOrder });
    map.set(row.workId, list);
  }
  return map;
}

async function loadPrimaryPartForWork(workId: string): Promise<PartRow | null> {
  const [row] = await db
    .select()
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId))
    .orderBy(asc(readingPartTable.sortOrder), asc(readingPartTable.id))
    .limit(1);
  return row ?? null;
}

async function countPartsForWork(workId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(readingPartTable).where(eq(readingPartTable.workId, workId));
  return Number(row?.value ?? 0);
}

/** Batch chapter counts for catalog / discover cards. */
async function loadPartCountsByWorkIds(workIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const id of workIds) {
    map.set(id, 0);
  }
  if (workIds.length === 0) {
    return map;
  }
  const rows = await db
    .select({ workId: readingPartTable.workId, value: count() })
    .from(readingPartTable)
    .where(inArray(readingPartTable.workId, workIds))
    .groupBy(readingPartTable.workId);
  for (const row of rows) {
    map.set(row.workId, Number(row.value));
  }
  return map;
}

async function loadOriginFileAsset(workId: string): Promise<AdminOriginAsset | null> {
  const [row] = await db
    .select({
      storageKey: contentAssetTable.storageKey,
      mimeType: contentAssetTable.mimeType,
      contentHash: contentAssetTable.contentHash,
      meta: contentAssetTable.meta,
    })
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.workId, workId), eq(contentAssetTable.kind, 'origin_file')))
    .limit(1);
  if (!row) {
    return null;
  }
  const meta = row.meta ?? {};
  return {
    fileName: String(meta.originalFileName ?? ''),
    size: Number(meta.size ?? 0),
    mimeType: row.mimeType,
    contentHash: row.contentHash,
    reused: Boolean(meta.reused),
  };
}

/** Batch source names keyed by work id. */
export async function loadSourcesByWorkIds(workIds: string[]): Promise<Map<string, string[]>> {
  if (workIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ workId: readingWorkSourceTable.workId, name: sourceTable.name })
    .from(readingWorkSourceTable)
    .innerJoin(sourceTable, eq(readingWorkSourceTable.sourceId, sourceTable.id))
    .where(inArray(readingWorkSourceTable.workId, workIds))
    .orderBy(asc(sourceTable.name));
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.workId) ?? [];
    list.push(row.name);
    map.set(row.workId, list);
  }
  return map;
}

async function loadSourcesForWork(workId: string): Promise<string[]> {
  const rows = await db
    .select({ name: sourceTable.name })
    .from(readingWorkSourceTable)
    .innerJoin(sourceTable, eq(readingWorkSourceTable.sourceId, sourceTable.id))
    .where(eq(readingWorkSourceTable.workId, workId));
  return rows.map((row) => row.name);
}

/** Current category name (single-select) or null when unset. */
async function loadCategoryForWork(workId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: categoryTable.name })
    .from(readingWorkCategoryTable)
    .innerJoin(categoryTable, eq(readingWorkCategoryTable.categoryId, categoryTable.id))
    .where(eq(readingWorkCategoryTable.workId, workId))
    .limit(1);
  return row?.name ?? null;
}

async function toAdminWork(row: WorkRow, parts?: PartRow[]): Promise<AdminWork> {
  const partRows = parts ?? (await loadPartsForWork(row.id));
  const primaryPart = partRows[0];
  const freshness = primaryPart
    ? (
        await getWorksDerivedFreshness([
          { id: row.id, partId: primaryPart.id, title: primaryPart.title, body: primaryPart.body },
        ])
      ).get(row.id)
    : { audio: 'missing' as const };
  const [tags, tagProvenance, category, categoryProvenance, sources] = await Promise.all([
    loadTagsForWork(row.id),
    loadTagProvenanceForWork(row.id),
    loadCategoryForWork(row.id),
    loadCategoryProvenanceForWork(row.id),
    loadSourcesForWork(row.id),
  ]);
  return {
    ...toWork(row, tags, sources),
    workflowPolicy: getWorkflowPolicyProjection(),
    derivedFreshness: freshness ?? { audio: 'missing' },
    originMeta: row.originMeta,
    originAsset: await loadOriginFileAsset(row.id),
    parts: partRows.map(toPart),
    category,
    failedStep: failedStepOf(row),
    metadataProvenance: buildMetadataProvenance(row, { tagProvenance, categoryProvenance }),
  };
}

/** List row projection — part bodies are too heavy for the admin table. */
async function toAdminWorkSummary(row: WorkRow): Promise<AdminWorkSummary> {
  const primaryPart = await loadPrimaryPartForWork(row.id);
  const freshness = primaryPart
    ? (
        await getWorksDerivedFreshness([
          { id: row.id, partId: primaryPart.id, title: primaryPart.title, body: primaryPart.body },
        ])
      ).get(row.id)
    : { audio: 'missing' as const };
  const partCount = await countPartsForWork(row.id);
  const [tags, tagProvenance, category, categoryProvenance, sources] = await Promise.all([
    loadTagsForWork(row.id),
    loadTagProvenanceForWork(row.id),
    loadCategoryForWork(row.id),
    loadCategoryProvenanceForWork(row.id),
    loadSourcesForWork(row.id),
  ]);
  return {
    ...toWork(row, tags, sources),
    workflowPolicy: getWorkflowPolicyProjection(),
    derivedFreshness: freshness ?? { audio: 'missing' },
    originMeta: row.originMeta,
    originAsset: await loadOriginFileAsset(row.id),
    partCount,
    category,
    failedStep: failedStepOf(row),
    metadataProvenance: buildMetadataProvenance(row, { tagProvenance, categoryProvenance }),
  };
}

/** The step that failed (originMeta.failedStep), validated against the enum. */
function failedStepOf(row: WorkRow): WorkflowStep | null {
  const value = row.originMeta?.failedStep;
  return typeof value === 'string' && (WORKFLOW_STEPS as readonly string[]).includes(value)
    ? (value as WorkflowStep)
    : null;
}

function hasExpiredWorkflowClaim(row: WorkRow, step: WorkflowStep): boolean {
  const meta = row.originMeta as Record<string, unknown>;
  const lease = meta.workflowClaimLeaseExpiresAt;
  return (
    meta.workflowClaimStep === step &&
    typeof meta.workflowClaimAttempt === 'string' &&
    meta.workflowClaimAttempt.length > 0 &&
    typeof lease === 'string' &&
    Number.isFinite(Date.parse(lease)) &&
    Date.parse(lease) <= Date.now()
  );
}

function hasExpiredWorkflowEnqueue(row: WorkRow, step: WorkflowStep): boolean {
  const meta = row.originMeta as Record<string, unknown>;
  const lease = meta.workflowEnqueueLeaseExpiresAt;
  return (
    meta.workflowEnqueueStep === step &&
    typeof meta.workflowEnqueueAttempt === 'string' &&
    meta.workflowEnqueueAttempt.length > 0 &&
    typeof lease === 'string' &&
    Number.isFinite(Date.parse(lease)) &&
    Date.parse(lease) <= Date.now()
  );
}

function workflowRetryLeaseRecoveryWhere(step: WorkflowStep) {
  return or(
    and(
      sql`${readingWorkTable.originMeta}->>'workflowClaimStep' = ${step}`,
      sql`(${readingWorkTable.originMeta}->>'workflowClaimLeaseExpiresAt')::timestamptz <= now()`,
    ),
    and(
      sql`${readingWorkTable.originMeta}->>'workflowEnqueueStep' = ${step}`,
      sql`(${readingWorkTable.originMeta}->>'workflowEnqueueLeaseExpiresAt')::timestamptz <= now()`,
    ),
  );
}

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function publishedListWhere(query: Pick<CatalogListQuery, 'tag' | 'q'>): SQL {
  const parts: SQL[] = [eq(readingWorkTable.status, 'published')];

  if (query.tag) {
    const normalized = normalizeTag(query.tag);
    parts.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(readingWorkTagTable)
          .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
          .where(and(eq(readingWorkTagTable.workId, readingWorkTable.id), eq(tagTable.normalized, normalized))),
      ),
    );
  }

  if (query.q) {
    const pattern = `%${escapeIlikePattern(query.q)}%`;
    parts.push(
      or(
        ilike(readingWorkTable.title, pattern),
        exists(
          db
            .select({ one: sql`1` })
            .from(readingWorkTagTable)
            .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
            .where(and(eq(readingWorkTagTable.workId, readingWorkTable.id), ilike(tagTable.name, pattern))),
        ),
      )!,
    );
  }

  return and(...parts)!;
}

function publishedListOrderBy(query: Pick<CatalogListQuery, 'sortBy' | 'sortOrder'>) {
  const column =
    query.sortBy === 'createdAt'
      ? readingWorkTable.createdAt
      : query.sortBy === 'updatedAt'
        ? readingWorkTable.updatedAt
        : readingWorkTable.publishedAt;
  const primary = query.sortOrder === 'asc' ? asc(column) : desc(column);
  return [primary, desc(readingWorkTable.id)] as const;
}

function aggregateTagNames(names: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const tag of names) {
    const key = tag.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    ordered.push(key);
  }
  return ordered;
}

/** Escape text for HTML body storage. */
function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Convert a plain-text body (textarea input) into paragraph HTML. */
export function textToParagraphHtml(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtmlText(paragraph)}</p>`)
    .join('\n');
}

/** Internal admin_text seed — creates one work + one body part (stored as HTML). */
export async function createAdminTextWork(input: CreateAdminTextWorkBody): Promise<AdminWork> {
  const workId = randomUUID();
  const partId = randomUUID();

  const [workRow] = await db
    .insert(readingWorkTable)
    .values({
      id: workId,
      title: input.title,
      description: '',
      status: 'ready',
      originKind: 'admin_text',
      publishedAt: null,
    })
    .returning();

  if (!workRow) {
    throw new AppError(500, 'Failed to create work');
  }

  const bodyHtml = textToParagraphHtml(input.body);
  const partStats = computePartReadingStats(bodyHtml);
  const workStats = computeWorkReadingStats([{ body: bodyHtml }], workRow.language);

  const [partRow] = await db
    .insert(readingPartTable)
    .values({
      id: partId,
      workId,
      sortOrder: 0,
      kind: 'body',
      title: input.title,
      body: bodyHtml,
      meta: { wordCount: partStats.wordCount },
    })
    .returning();

  if (!partRow) {
    throw new AppError(500, 'Failed to create part');
  }

  const [updatedWork] = await db
    .update(readingWorkTable)
    .set({
      wordCount: workStats.wordCount,
      estimatedMinutes: workStats.estimatedMinutes,
      suggestedVocabSize: workStats.suggestedVocabSize,
      difficultyScore: workStats.difficultyScore,
      statsProvenance: workStats.statsProvenance,
    })
    .where(eq(readingWorkTable.id, workId))
    .returning();

  return toAdminWork(updatedWork ?? workRow, [partRow]);
}

/** EPUB upload spec — MVP only accepts EPUB files (UI advertises TXT/PDF but they are rejected). */
export const EPUB_UPLOAD_SPEC: UploadSpec = {
  allowedExtensions: ['epub'],
  allowedMimeTypes: ['application/epub+zip', 'application/zip', 'application/octet-stream'],
  maxBytes: EPUB_UPLOAD_MAX_BYTES,
  validateContent: (body) => (isZipFile(body) ? null : 'EPUB 文件内容无效（非 ZIP 格式）'),
  keyBuilder: (contentHash) => `epub/${contentHash}.epub`,
};

function stripFileExtension(fileName: string): string {
  const extension = fileExtension(fileName);
  return extension ? fileName.slice(0, -(extension.length + 1)) : fileName;
}

/**
 * Create the ReadingWork (draft, admin_epub) + ContentAsset (origin_file) rows
 * that reference an uploaded object. DB stores only the object storage key.
 * On failure the acquired reference is released (may garbage-collect the object).
 */
async function insertEpubWorkAndAsset(input: {
  fileName: string;
  meta: UploadedFileMeta;
  reused: boolean;
}): Promise<CreateEpubWorkResult> {
  const workId = randomUUID();
  const title = stripFileExtension(input.fileName).slice(0, 200) || input.fileName;
  const retryJobToken = WORKFLOW_AUTO_CHAIN ? randomUUID() : undefined;
  const originMeta = {
    originalFileName: input.fileName,
    reused: input.reused,
    ...(retryJobToken ? { retryJobToken } : {}),
  };

  try {
    await db.insert(readingWorkTable).values({
      id: workId,
      title,
      description: '',
      status: WORKFLOW_AUTO_CHAIN ? 'processing' : 'uploaded',
      originKind: 'admin_epub',
      originMeta,
      publishedAt: null,
    });

    await db.insert(contentAssetTable).values({
      id: randomUUID(),
      workId,
      kind: 'origin_file',
      status: 'ready',
      storageKey: input.meta.storageKey,
      mimeType: input.meta.mimeType,
      contentHash: input.meta.contentHash,
      meta: { size: input.meta.size, originalFileName: input.fileName, reused: input.reused },
    });
  } catch (error) {
    try {
      await releaseUploadedObject(input.meta.storageKey);
    } catch (cleanupError) {
      workLogger.warn({ err: cleanupError, storageKey: input.meta.storageKey }, 'Failed to release upload reference');
    }
    throw error;
  }

  return {
    id: workId,
    title,
    status: WORKFLOW_AUTO_CHAIN ? 'processing' : 'uploaded',
    originKind: 'admin_epub',
    originMeta,
    asset: {
      storageKey: input.meta.storageKey,
      mimeType: input.meta.mimeType,
      contentHash: input.meta.contentHash,
      size: input.meta.size,
    },
  };
}

/**
 * Admin EPUB upload (multipart) — dedupe-aware store, then create work + asset.
 * When the same file was uploaded before, the existing object is reused
 * (instant upload, `duplicated: true`) and no bytes are written.
 */
export async function createAdminEpubWork(input: {
  fileName: string;
  body: Buffer;
  contentType: string;
}): Promise<CreateEpubWorkResult> {
  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new ValidationFailedError([{ path: 'file', message: '请选择要上传的 EPUB 文件' }]);
  }

  const result = await acquireUploadedObject({
    kind: 'file',
    fileName,
    body: input.body,
    contentType: input.contentType,
    spec: EPUB_UPLOAD_SPEC,
  });
  if (!result) {
    throw new AppError(500, 'Failed to upload EPUB');
  }

  const created = await insertEpubWorkAndAsset({
    fileName,
    meta: result.meta,
    reused: result.duplicated,
  });
  if (WORKFLOW_AUTO_CHAIN) {
    const retryJobToken = String(created.originMeta.retryJobToken);
    const enqueueAttemptToken = randomUUID();
    if (!(await prepareWorkflowEnqueue(created.id, 'parse', 'processing', retryJobToken, enqueueAttemptToken))) {
      throw new AppError(500, 'Failed to reserve EPUB parse enqueue');
    }
    try {
      await enqueue(
        JOB_CONTENT_PARSE,
        { workId: created.id, retryJobToken },
        { attempts: 2, jobId: `${JOB_CONTENT_PARSE}:${created.id}:${retryJobToken}` },
      );
    } catch (error) {
      await failWorkflowEnqueue(created.id, 'parse', retryJobToken, 'processing', enqueueAttemptToken, error);
      throw error;
    }
  }
  return created;
}

/**
 * Instant upload (reuse) path — client already computed the file hash and asks
 * whether the object exists. Returns null when unknown (caller falls back to a
 * real upload); otherwise creates work + asset reusing the stored object.
 */
export async function reuseAdminEpubWork(input: {
  fileName: string;
  contentHash: string;
}): Promise<CreateEpubWorkResult | null> {
  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new ValidationFailedError([{ path: 'fileName', message: '请提供文件名' }]);
  }
  if (!isValidContentHash(input.contentHash)) {
    throw new ValidationFailedError([{ path: 'contentHash', message: '文件哈希无效' }]);
  }

  const extension = fileExtension(fileName);
  if (!extension || !EPUB_UPLOAD_SPEC.allowedExtensions.includes(extension)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, '仅支持 .epub 格式文件');
  }

  const result = await acquireUploadedObject({
    kind: 'hash',
    fileName,
    contentHash: input.contentHash,
    spec: EPUB_UPLOAD_SPEC,
  });
  if (!result) {
    return null;
  }

  const created = await insertEpubWorkAndAsset({ fileName, meta: result.meta, reused: true });
  if (WORKFLOW_AUTO_CHAIN) {
    const retryJobToken = String(created.originMeta.retryJobToken);
    const enqueueAttemptToken = randomUUID();
    if (!(await prepareWorkflowEnqueue(created.id, 'parse', 'processing', retryJobToken, enqueueAttemptToken))) {
      throw new AppError(500, 'Failed to reserve EPUB parse enqueue');
    }
    try {
      await enqueue(
        JOB_CONTENT_PARSE,
        { workId: created.id, retryJobToken },
        { attempts: 2, jobId: `${JOB_CONTENT_PARSE}:${created.id}:${retryJobToken}` },
      );
    } catch (error) {
      await failWorkflowEnqueue(created.id, 'parse', retryJobToken, 'processing', enqueueAttemptToken, error);
      throw error;
    }
  }
  return created;
}

export async function listAdminWorks(query: AdminWorkListQuery): Promise<AdminWorkListData> {
  const statuses = query.status ? query.status.split(',') : undefined;
  const where = statuses ? inArray(readingWorkTable.status, statuses) : undefined;
  const primary = query.sortOrder === 'asc' ? asc(readingWorkTable.updatedAt) : desc(readingWorkTable.updatedAt);
  const offset = (query.page - 1) * query.pageSize;

  const [countRow] = where
    ? await db.select({ value: count() }).from(readingWorkTable).where(where)
    : await db.select({ value: count() }).from(readingWorkTable);
  const total = Number(countRow?.value ?? 0);

  const rows = where
    ? await db
        .select()
        .from(readingWorkTable)
        .where(where)
        .orderBy(primary, desc(readingWorkTable.id))
        .limit(query.pageSize)
        .offset(offset)
    : await db
        .select()
        .from(readingWorkTable)
        .orderBy(primary, desc(readingWorkTable.id))
        .limit(query.pageSize)
        .offset(offset);

  const items = await Promise.all(rows.map((row) => toAdminWorkSummary(row)));

  return {
    items,
    pagination: buildPaginationMeta({
      page: query.page,
      pageSize: query.pageSize,
      total,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
  };
}

export async function getAdminWork(id: string): Promise<AdminWork> {
  let [row] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!row) {
    throw new NotFoundError('Work');
  }
  // Heal works left in `tts` after the auto-TTS pipeline was turned off.
  if (!TTS_STEP_ENABLED && row.status === 'tts') {
    await completeWorkflowStep(id, 'ready');
    [row] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
    if (!row) {
      throw new NotFoundError('Work');
    }
  }
  return toAdminWork(row);
}

export async function updateWork(id: string, input: UpdateWorkBody): Promise<AdminWork> {
  const [existing] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError('Work');
  }

  const patch: Partial<typeof readingWorkTable.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.author !== undefined) patch.author = input.author;
  if (input.description !== undefined) {
    patch.description = input.description;
    patch.descriptionProvenance = 'manual';
  }
  if (input.suggestedVocabSize !== undefined) {
    patch.suggestedVocabSize = input.suggestedVocabSize;
    patch.statsProvenance = 'manual';
  }
  if (input.difficultyScore !== undefined) {
    patch.difficultyScore = input.difficultyScore;
    patch.statsProvenance = 'manual';
  }

  if (
    input.tags === undefined &&
    input.sources === undefined &&
    input.category === undefined &&
    input.suggestedVocabSize === undefined &&
    input.difficultyScore === undefined &&
    Object.keys(patch).length === 0
  ) {
    return toAdminWork(existing);
  }

  await db.transaction(async (tx) => {
    if (input.tags !== undefined) {
      const tagIds: string[] = [];
      for (const name of input.tags) {
        const [row] = await tx
          .insert(tagTable)
          .values({ id: randomUUID(), name, normalized: normalizeTag(name), origin: 'manual' })
          .onConflictDoUpdate({ target: tagTable.normalized, set: { name } })
          .returning();
        tagIds.push(row!.id);
      }
      await tx
        .delete(readingWorkTagTable)
        .where(and(eq(readingWorkTagTable.workId, id), eq(readingWorkTagTable.provenance, 'manual')));
      if (tagIds.length > 0) {
        await tx
          .insert(readingWorkTagTable)
          .values(tagIds.map((tagId) => ({ workId: id, tagId, provenance: 'manual' as const })))
          .onConflictDoNothing();
      }
    }

    if (input.sources !== undefined) {
      const sourceIds: string[] = [];
      for (const name of input.sources) {
        const [row] = await tx
          .insert(sourceTable)
          .values({ id: randomUUID(), name, origin: 'manual' })
          .onConflictDoUpdate({ target: sourceTable.name, set: { name } })
          .returning();
        sourceIds.push(row!.id);
      }
      await tx
        .delete(readingWorkSourceTable)
        .where(and(eq(readingWorkSourceTable.workId, id), eq(readingWorkSourceTable.provenance, 'manual')));
      if (sourceIds.length > 0) {
        await tx
          .insert(readingWorkSourceTable)
          .values(sourceIds.map((sourceId) => ({ workId: id, sourceId, provenance: 'manual' as const })))
          .onConflictDoNothing();
      }
    }

    // Category: single-select — setting replaces every association (manual),
    // empty string clears it entirely.
    if (input.category !== undefined) {
      await tx.delete(readingWorkCategoryTable).where(eq(readingWorkCategoryTable.workId, id));
      const categoryName = input.category.trim();
      if (categoryName) {
        const [row] = await tx
          .insert(categoryTable)
          .values({ id: randomUUID(), name: categoryName, normalized: normalizeTag(categoryName), origin: 'manual' })
          .onConflictDoUpdate({ target: categoryTable.normalized, set: { name: categoryName } })
          .returning();
        await tx
          .insert(readingWorkCategoryTable)
          .values({ workId: id, categoryId: row!.id, provenance: 'manual' })
          .onConflictDoNothing();
      }
    }

    if (Object.keys(patch).length > 0) {
      await tx.update(readingWorkTable).set(patch).where(eq(readingWorkTable.id, id));
    }
  });

  return getAdminWork(id);
}

export async function publishWork(id: string): Promise<AdminWork> {
  const [existing] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError('Work');
  }
  if (existing.status !== 'ready') {
    throw new AppError(HTTP_STATUS.CONFLICT, '仅全部步骤完成的作品可以发布');
  }

  const parts = await loadPartsForWork(id);
  const tags = await loadTagsForWork(id);
  const sources = await loadSourcesForWork(id);
  const issues = getPublishWorkIssues({
    title: existing.title,
    sources,
    tags,
    parts: parts.map((part) => ({ body: part.body })),
  });
  if (issues.length > 0) {
    throw new ValidationFailedError(issues);
  }

  const [row] = await db
    .update(readingWorkTable)
    .set({ status: 'published', publishedAt: new Date() })
    .where(eq(readingWorkTable.id, id))
    .returning();

  if (!row) {
    throw new NotFoundError('Work');
  }
  return toAdminWork(row, parts);
}

export async function unpublishWork(id: string): Promise<AdminWork> {
  const [existing] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError('Work');
  }
  if (existing.status !== 'published') {
    throw new AppError(HTTP_STATUS.CONFLICT, '仅已发布作品可以下架');
  }

  const [row] = await db
    .update(readingWorkTable)
    .set({ status: 'ready', publishedAt: null })
    .where(eq(readingWorkTable.id, id))
    .returning();

  if (!row) {
    throw new NotFoundError('Work');
  }
  return toAdminWork(row);
}

const STEP_JOB: Record<Exclude<WorkflowStep, 'tts'>, string> = {
  parse: JOB_CONTENT_PARSE,
  metadata: JOB_METADATA_FILL,
};

/**
 * Workflow retry / re-run / manual next-step. Without `step` it resumes from
 * the failed step (originMeta.failedStep); with `step` it re-runs that step.
 * Sets the running status and enqueues the job immediately — output reset runs
 * inside the job so the admin click returns quickly. Refused while a step is
 * actively running or while published.
 */
export async function retryWorkflow(id: string, input: RetryWorkflowBody = {}): Promise<AdminWork> {
  const [existing] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError('Work');
  }
  if (existing.originKind !== 'admin_epub') {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, '仅 EPUB 作品支持流程重试');
  }
  if (existing.status === 'published') {
    throw new AppError(HTTP_STATUS.CONFLICT, '请先下架作品后再重试');
  }
  const step = input.step ?? failedStepOf(existing);
  const retryJobToken = randomUUID();
  if (!step) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, '没有可重试的步骤');
  }
  const running = existing.status === 'processing' || existing.status === 'metadata' || existing.status === 'tts';
  const expiredClaim = hasExpiredWorkflowClaim(existing, step);
  const expiredEnqueue = hasExpiredWorkflowEnqueue(existing, step);
  if (running && !expiredClaim && !expiredEnqueue) {
    throw new AppError(HTTP_STATUS.CONFLICT, '作品正在处理中，请稍后再试');
  }
  const retryAttemptToken = randomUUID();
  if (step === 'tts') {
    if (!TTS_STEP_ENABLED) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, '音频步骤未启用自动流程，请在作品页手动生成');
    }
    const [claimed] = await db
      .update(readingWorkTable)
      .set({
        status: stepRunningStatus(step),
        originMeta: {
          ...existing.originMeta,
          failedStep: undefined,
          lastError: undefined,
          failedAt: undefined,
          retryJobToken,
          workflowClaimAttempt: undefined,
          workflowClaimStep: undefined,
          workflowClaimLeaseExpiresAt: undefined,
          workflowEnqueueStep: 'tts',
          workflowEnqueueAttempt: retryAttemptToken,
          workflowEnqueueLeaseExpiresAt: workflowLeaseExpiresAt(),
        },
      })
      .where(
        and(
          eq(readingWorkTable.id, id),
          eq(readingWorkTable.status, existing.status),
          running ? workflowRetryLeaseRecoveryWhere(step) : sql`true`,
        ),
      )
      .returning({ id: readingWorkTable.id });
    if (!claimed) {
      throw new AppError(HTTP_STATUS.CONFLICT, '作品状态已变化，请刷新后再试');
    }
    const { enqueueWorkAudio } = await import('@/modules/content-assets/service');
    try {
      await enqueueWorkAudio(id, { force: false, roles: ['us', 'uk'] });
    } catch (error) {
      await failWorkflowEnqueue(id, 'tts', retryJobToken, 'tts', retryAttemptToken, error);
      throw error;
    }
    return getAdminWork(id);
  }

  // Queue only — step output reset runs inside the job so HTTP returns quickly.
  const [claimed] = await db
    .update(readingWorkTable)
    .set({
      status: stepRunningStatus(step),
      originMeta: {
        ...existing.originMeta,
        failedStep: undefined,
        lastError: undefined,
        failedAt: undefined,
        retryJobToken,
        workflowClaimAttempt: undefined,
        workflowClaimStep: undefined,
        workflowClaimLeaseExpiresAt: undefined,
        workflowEnqueueStep: step,
        workflowEnqueueAttempt: retryAttemptToken,
        workflowEnqueueLeaseExpiresAt: workflowLeaseExpiresAt(),
        ...(step === 'metadata'
          ? { metadataAt: undefined, metadataEnrichGaps: undefined, metadataEnrichError: undefined }
          : {}),
        ...(step === 'parse' ? { parsed: undefined, metadataAt: undefined, metadataEnrichGaps: undefined } : {}),
      },
    })
    .where(
      and(
        eq(readingWorkTable.id, id),
        eq(readingWorkTable.status, existing.status),
        running ? workflowRetryLeaseRecoveryWhere(step) : sql`true`,
      ),
    )
    .returning({ id: readingWorkTable.id });
  if (!claimed) {
    throw new AppError(HTTP_STATUS.CONFLICT, '作品状态已变化，请刷新后再试');
  }

  try {
    await enqueue(
      STEP_JOB[step],
      { workId: id, retryJobToken },
      { attempts: 2, jobId: `${STEP_JOB[step]}:${id}:${retryJobToken}` },
    );
  } catch (error) {
    await failWorkflowEnqueue(id, step, retryJobToken, stepRunningStatus(step), retryAttemptToken, error);
    throw error;
  }
  return getAdminWork(id);
}

export async function deleteWork(id: string): Promise<void> {
  const [existing] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError('Work');
  }
  if (existing.status === 'published') {
    throw new AppError(HTTP_STATUS.CONFLICT, '请先下架');
  }

  const parts = await loadPartsForWork(id);
  const assetRows = await db
    .select({
      storageKey: contentAssetTable.storageKey,
      kind: contentAssetTable.kind,
      partId: contentAssetTable.partId,
      meta: contentAssetTable.meta,
    })
    .from(contentAssetTable)
    .where(eq(contentAssetTable.workId, id));

  for (const row of assetRows) {
    if (!row.storageKey) {
      continue;
    }
    if (row.kind === 'origin_file') {
      // Dedup-registered objects: release one reference; garbage-collected at zero.
      await releaseUploadedObject(row.storageKey);
    } else if (row.kind.startsWith('audio_')) {
      const { deleteAudioAssetObjects } = await import('@/modules/content-assets/service');
      await deleteAudioAssetObjects({ kind: row.kind, storageKey: row.storageKey, meta: row.meta });
    } else {
      await deleteObject(row.storageKey);
    }
  }

  for (const part of parts) {
    await deleteBilingualCacheForPart(part.id);
  }

  await db
    .delete(conversationTable)
    .where(and(eq(conversationTable.subjectType, 'reading_work'), eq(conversationTable.subjectId, id)));

  await db.delete(readingWorkTable).where(eq(readingWorkTable.id, id));
}

export async function listCatalogWorks(query: CatalogListQuery): Promise<CatalogListData> {
  const where = publishedListWhere(query);
  const orderBy = publishedListOrderBy(query);
  const offset = (query.page - 1) * query.pageSize;

  const [countRow] = await db.select({ value: count() }).from(readingWorkTable).where(where);
  const total = Number(countRow?.value ?? 0);

  const rows = await db
    .select()
    .from(readingWorkTable)
    .where(where)
    .orderBy(...orderBy)
    .limit(query.pageSize)
    .offset(offset);

  const workIds = rows.map((row) => row.id);
  const [tagsByWork, sourcesByWork, partCountsByWork] = await Promise.all([
    loadTagsByWorkIds(workIds),
    loadSourcesByWorkIds(workIds),
    loadPartCountsByWorkIds(workIds),
  ]);

  const tagRows = await db
    .selectDistinct({ name: tagTable.name })
    .from(readingWorkTagTable)
    .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
    .innerJoin(readingWorkTable, eq(readingWorkTagTable.workId, readingWorkTable.id))
    .where(eq(readingWorkTable.status, 'published'))
    .orderBy(asc(tagTable.name));

  return {
    items: rows.map((row) => ({
      ...toWork(row, tagsByWork.get(row.id) ?? [], sourcesByWork.get(row.id) ?? []),
      partCount: partCountsByWork.get(row.id) ?? 0,
    })),
    pagination: buildPaginationMeta({
      page: query.page,
      pageSize: query.pageSize,
      total,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
    tags: aggregateTagNames(tagRows.map((row) => row.name)),
  };
}

export async function getPublishedWork(id: string): Promise<Work> {
  const [row] = await db
    .select()
    .from(readingWorkTable)
    .where(and(eq(readingWorkTable.id, id), eq(readingWorkTable.status, 'published')))
    .limit(1);

  if (!row) {
    throw new NotFoundError('Work');
  }
  const hydrated = await ensureWorkReadingStatsIfMissing(row);
  const tags = await loadTagsForWork(id);
  const sources = await loadSourcesForWork(id);
  return toWork(hydrated, tags, sources);
}

export async function requirePublishedWorkWithParts(workId: string): Promise<{ work: WorkRow; parts: PartRow[] }> {
  const [work] = await db
    .select()
    .from(readingWorkTable)
    .where(and(eq(readingWorkTable.id, workId), eq(readingWorkTable.status, 'published')))
    .limit(1);
  if (!work) {
    throw new NotFoundError('Work');
  }
  const hydrated = await ensureWorkReadingStatsIfMissing(work);
  const parts = await loadPartsForWork(workId);
  if (parts.length === 0) {
    throw new NotFoundError('Part');
  }
  return { work: hydrated, parts };
}

export async function getPartById(partId: string): Promise<PartRow> {
  const [row] = await db.select().from(readingPartTable).where(eq(readingPartTable.id, partId)).limit(1);
  if (!row) {
    throw new NotFoundError('Part');
  }
  return row;
}
