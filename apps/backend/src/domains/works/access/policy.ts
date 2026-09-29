import { and, eq } from 'drizzle-orm';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';

import type { WorkReadActor } from '@/domains/works/access/actor';
import { canReadWorkRow, workReadAccessSql } from '@/domains/works/access/predicate';
import type { PartRow, WorkRow } from '@/domains/works/read-model/projection';
import { loadPartsForWork } from '@/domains/works/read-model/relations';
import { ensureWorkReadingStatsIfMissing } from '@/domains/works/read-model/stats';
import { db } from '@/infra/db';
import { NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

export type ReadablePartAccess = {
  workId: string;
  workTitle: string;
  coverAssetId: string | null;
  partId: string;
  partTitle: string;
  body: string;
  sortOrder: number;
  kind: string;
};

async function loadReadableWork(actor: WorkReadActor, workId: string): Promise<WorkRow> {
  const access = workReadAccessSql(actor);
  const where = access ? and(eq(readingWorkTable.id, workId), access) : eq(readingWorkTable.id, workId);

  const [work] = await db.select().from(readingWorkTable).where(where).limit(1);
  if (!work) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  return ensureWorkReadingStatsIfMissing(work);
}

export async function requireReadableWorkWithParts(
  actor: WorkReadActor,
  workId: string,
): Promise<{ work: WorkRow; parts: PartRow[] }> {
  const work = await loadReadableWork(actor, workId);
  const parts = await loadPartsForWork(workId);
  if (parts.length === 0) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
  }
  return { work, parts };
}

export async function requireReadablePart(
  actor: WorkReadActor,
  partId: string,
  options?: { workId?: string },
): Promise<ReadablePartAccess> {
  const predicates = [eq(readingPartTable.id, partId)];
  if (options?.workId) {
    predicates.push(eq(readingPartTable.workId, options.workId));
  }
  const access = workReadAccessSql(actor);
  if (access) {
    predicates.push(access);
  }

  const rows = await db
    .select({
      workId: readingWorkTable.id,
      workTitle: readingWorkTable.title,
      coverAssetId: readingWorkTable.coverAssetId,
      partId: readingPartTable.id,
      partTitle: readingPartTable.title,
      body: readingPartTable.body,
      sortOrder: readingPartTable.sortOrder,
      kind: readingPartTable.kind,
    })
    .from(readingPartTable)
    .innerJoin(readingWorkTable, eq(readingPartTable.workId, readingWorkTable.id))
    .where(and(...predicates))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
  }
  return row;
}

export async function resolveReadableWorkTitle(actor: WorkReadActor, workId: string): Promise<string | undefined> {
  try {
    const work = await loadReadableWork(actor, workId);
    return work.title;
  } catch (error) {
    if (error instanceof NotFoundError) {
      return undefined;
    }
    throw error;
  }
}

export async function resolveReadableWorkIdForPart(actor: WorkReadActor, partId: string): Promise<string | undefined> {
  const [row] = await db
    .select({
      workId: readingPartTable.workId,
      ownerUserId: readingWorkTable.ownerUserId,
      visibility: readingWorkTable.visibility,
      publishedAt: readingWorkTable.publishedAt,
    })
    .from(readingPartTable)
    .innerJoin(readingWorkTable, eq(readingPartTable.workId, readingWorkTable.id))
    .where(eq(readingPartTable.id, partId))
    .limit(1);
  if (!row || !canReadWorkRow(actor, row)) {
    return undefined;
  }
  return row.workId;
}

export async function assertCanReadWork(actor: WorkReadActor, workId: string): Promise<void> {
  await loadReadableWork(actor, workId);
}
