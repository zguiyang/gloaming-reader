import { and, eq } from 'drizzle-orm';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';

import { db } from '@/infra/db';
import { NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

import type { PartRow, WorkRow } from './projection';
import { loadPartsForWork } from './relations';
import { ensureWorkReadingStatsIfMissing } from './stats';

export async function requirePublishedWorkWithParts(workId: string): Promise<{ work: WorkRow; parts: PartRow[] }> {
  const [work] = await db
    .select()
    .from(readingWorkTable)
    .where(and(eq(readingWorkTable.id, workId), eq(readingWorkTable.status, 'published')))
    .limit(1);
  if (!work) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  const hydrated = await ensureWorkReadingStatsIfMissing(work);
  const parts = await loadPartsForWork(workId);
  if (parts.length === 0) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
  }
  return { work: hydrated, parts };
}

export async function getPartById(partId: string): Promise<PartRow> {
  const [row] = await db.select().from(readingPartTable).where(eq(readingPartTable.id, partId)).limit(1);
  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
  }
  return row;
}

export type PublishedPartAccess = {
  workId: string;
  workTitle: string;
  partId: string;
  partTitle: string;
  body: string;
};

export async function requirePublishedPart(
  partId: string,
  options?: { workId?: string },
): Promise<PublishedPartAccess> {
  const predicates = [eq(readingPartTable.id, partId), eq(readingWorkTable.status, 'published')];
  if (options?.workId) {
    predicates.push(eq(readingPartTable.workId, options.workId));
  }

  const rows = await db
    .select({
      workId: readingWorkTable.id,
      workTitle: readingWorkTable.title,
      partId: readingPartTable.id,
      partTitle: readingPartTable.title,
      body: readingPartTable.body,
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
