import { eq } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@gloaming/db';
import type { AdminWork } from '@gloaming/shared/works';

import { buildPublishIssuesForWork } from '@/domains/works/admin/admin-publish-gate';
import { getAdminWork } from '@/domains/works/admin/admin-work-read';
import { loadPartsForWork, loadSourcesForWork, loadTagsForWork } from '@/domains/works/read-model/relations';
import { db } from '@/infra/db';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError, NotFoundError, ValidationFailedError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

async function loadAdminWorkAfterMutation(id: string): Promise<AdminWork> {
  return getAdminWork(id);
}

export async function publishWork(id: string): Promise<AdminWork> {
  const [existing] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  if (existing.processingStatus !== 'ready') {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.WORK.PUBLISH_INCOMPLETE);
  }

  const parts = await loadPartsForWork(id);
  const tags = await loadTagsForWork(id);
  const sources = await loadSourcesForWork(id);
  const issues = await buildPublishIssuesForWork(existing, parts, tags, sources);
  if (issues.length > 0) {
    throw new ValidationFailedError(issues);
  }

  const [row] = await db
    .update(readingWorkTable)
    .set({ publishedAt: new Date() })
    .where(eq(readingWorkTable.id, id))
    .returning();

  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  return loadAdminWorkAfterMutation(id);
}

export async function unpublishWork(id: string): Promise<AdminWork> {
  const [existing] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  if (!existing.publishedAt) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.WORK.UNPUBLISH_NOT_PUBLISHED);
  }

  const [row] = await db
    .update(readingWorkTable)
    .set({ publishedAt: null })
    .where(eq(readingWorkTable.id, id))
    .returning();

  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  return loadAdminWorkAfterMutation(id);
}
