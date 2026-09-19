import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@gloaming/db';

import { db } from '@/db';
import { rootLogger } from '@/lib/logger';
import { workflowClaimWhere } from '@/lib/workflow';
import { deleteObject } from '@/modules/oss';

const parseArtifactsLogger = rootLogger.child({ module: 'ContentParser' });

type WorkOriginMeta = (typeof readingWorkTable.$inferSelect)['originMeta'];

export type ParseArtifactManifest = {
  attemptToken: string;
  keys: string[];
};

export function imageKey(workId: string, attemptToken: string, contentHash: string, mime: string): string {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/gif' ? 'gif' : mime === 'image/webp' ? 'webp' : 'jpg';
  return `book-images/${workId}/${attemptToken}/${contentHash}.${ext}`;
}

export function coverKey(workId: string, attemptToken: string, mime: string): string {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/gif' ? 'gif' : mime === 'image/webp' ? 'webp' : 'jpg';
  return `covers/${workId}/${attemptToken}.${ext}`;
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function parseArtifactManifests(originMeta: WorkOriginMeta): ParseArtifactManifest[] {
  const value = (originMeta as Record<string, unknown>).workflowParseArtifacts;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const candidate = entry as { attemptToken?: unknown; keys?: unknown };
    if (
      typeof candidate.attemptToken !== 'string' ||
      !Array.isArray(candidate.keys) ||
      !candidate.keys.every((key): key is string => typeof key === 'string')
    ) {
      return [];
    }
    return [{ attemptToken: candidate.attemptToken, keys: candidate.keys }];
  });
}

export async function deleteParseArtifactKeys(keys: string[]): Promise<void> {
  for (const key of [...new Set(keys)]) {
    try {
      await deleteObject(key);
    } catch (error) {
      parseArtifactsLogger.warn({ err: error, key }, 'Failed to delete uncommitted parse artifact');
    }
  }
}

export async function registerParseArtifactManifest(
  workId: string,
  retryJobToken: string,
  attemptToken: string,
  keys: string[],
): Promise<boolean> {
  const [registered] = await db
    .update(readingWorkTable)
    .set({
      originMeta: sql`jsonb_set(${readingWorkTable.originMeta}, '{workflowParseArtifacts}', coalesce(${readingWorkTable.originMeta}->'workflowParseArtifacts', '[]'::jsonb) || ${JSON.stringify([{ attemptToken, keys }])}::jsonb, true)`,
    })
    .where(workflowClaimWhere(workId, 'parse', retryJobToken, attemptToken))
    .returning({ id: readingWorkTable.id });
  return Boolean(registered);
}
