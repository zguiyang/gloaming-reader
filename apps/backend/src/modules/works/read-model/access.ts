import { and, eq } from 'drizzle-orm';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';

import { db } from '@/db';
import { NotFoundError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';

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
