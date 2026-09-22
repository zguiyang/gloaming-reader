import { eq } from 'drizzle-orm';

import { readingPart as readingPartTable } from '@gloaming/db';

import { db } from '@/infra/db';
import { NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

export async function loadPart(partId: string): Promise<{
  id: string;
  workId: string;
  title: string;
  body: string;
  sortOrder: number;
}> {
  const rows = await db
    .select({
      id: readingPartTable.id,
      workId: readingPartTable.workId,
      title: readingPartTable.title,
      body: readingPartTable.body,
      sortOrder: readingPartTable.sortOrder,
    })
    .from(readingPartTable)
    .where(eq(readingPartTable.id, partId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
  }
  return row;
}
