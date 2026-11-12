import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@gloaming/db';

import { workflowClaimWhere } from '@/domains/works/lifecycle';
import { db } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';
import { deleteObject } from '@/infra/storage';

const parseArtifactsLogger = rootLogger.child({ module: 'ContentParser' });

type WorkOriginMeta = (typeof readingWorkTable.$inferSelect)['originMeta'];

export type ParseArtifactManifest = {
  attemptToken: string;
  keys: string[];
};

const PARSE_IMAGE_KEY_VERSION = 'img-v1';

/** File extension for object keys from the final stored MIME type (not a default JPEG). */
export function storageExtensionForMime(mime: string): string {
  const normalized = mime.trim().toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
    return 'jpg';
  }
  if (normalized === 'image/png') {
    return 'png';
  }
  if (normalized === 'image/gif') {
    return 'gif';
  }
  if (normalized === 'image/webp') {
    return 'webp';
  }
  if (normalized === 'image/svg+xml') {
    return 'svg';
  }
  return 'bin';
}

export function imageKey(workId: string, attemptToken: string, sourceHash: string, mime: string): string {
  const ext = storageExtensionForMime(mime);
  return `book-images/${workId}/${attemptToken}/${PARSE_IMAGE_KEY_VERSION}/${sourceHash}.${ext}`;
}

export function coverKey(workId: string, attemptToken: string, sourceHash: string, mime: string): string {
  const ext = storageExtensionForMime(mime);
  return `covers/${workId}/${attemptToken}/${PARSE_IMAGE_KEY_VERSION}/${sourceHash}.${ext}`;
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
