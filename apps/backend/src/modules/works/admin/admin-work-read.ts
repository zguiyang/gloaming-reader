import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkTag as readingWorkTagTable,
  type WorkMetadataProvenance,
  type WorkMetadataProvenanceMap,
} from '@gloaming/db';
import { buildPaginationMeta } from '@gloaming/shared/pagination';
import {
  type AdminOriginAsset,
  type AdminWork,
  type AdminWorkListData,
  type AdminWorkListQuery,
  type AdminWorkSummary,
} from '@gloaming/shared/works';

import { db } from '@/db';
import { NotFoundError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { completeWorkflowStep } from '@/lib/workflow';
import { getWorkflowPolicyProjection, TTS_STEP_ENABLED } from '@/lib/workflow-policy';
import { getWorksDerivedFreshness } from '@/modules/derived-freshness';
import { buildPublishIssuesForWork } from '@/modules/works/admin/admin-publish-gate';
import {
  loadCategoryForWork,
  loadPartsForWork,
  loadSourcesForWork,
  loadTagsForWork,
  shouldHideTagsDuringProcessing,
  toPart,
  toWork,
} from '@/modules/works/queries';
import { failedStepOf } from '@/modules/works/workflow-meta';

type WorkRow = typeof readingWorkTable.$inferSelect;
type PartRow = typeof readingPartTable.$inferSelect;

function resolveTagProvenance(provenances: WorkMetadataProvenance[]): WorkMetadataProvenance | undefined {
  if (provenances.some((p) => p === 'manual')) return 'manual';
  if (provenances.some((p) => p === 'ai')) return 'ai';
  if (provenances.some((p) => p === 'extracted')) return 'extracted';
  return undefined;
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

export async function toAdminWork(row: WorkRow, parts?: PartRow[]): Promise<AdminWork> {
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
  const publishIssues = await buildPublishIssuesForWork(row, partRows, tags, sources);
  return {
    ...toWork(row, tags, sources, category),
    workflowPolicy: getWorkflowPolicyProjection(),
    derivedFreshness: freshness ?? { audio: 'missing' },
    publishIssues,
    originMeta: row.originMeta,
    originAsset: await loadOriginFileAsset(row.id),
    parts: partRows.map(toPart),
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
    ...toWork(row, tags, sources, category),
    workflowPolicy: getWorkflowPolicyProjection(),
    derivedFreshness: freshness ?? { audio: 'missing' },
    originMeta: row.originMeta,
    originAsset: await loadOriginFileAsset(row.id),
    partCount,
    failedStep: failedStepOf(row),
    metadataProvenance: buildMetadataProvenance(row, { tagProvenance, categoryProvenance }),
  };
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
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  // Heal works left in `tts` after the auto-TTS pipeline was turned off.
  if (!TTS_STEP_ENABLED && row.status === 'tts') {
    await completeWorkflowStep(id, 'ready');
    [row] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
    if (!row) {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
    }
  }
  return toAdminWork(row);
}
