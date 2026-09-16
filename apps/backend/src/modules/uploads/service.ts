import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { uploadedObject as uploadedObjectTable } from '@gloaming/db';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { ERROR_CODES } from '@/lib/error-codes';
import { AppError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import { acquireLockWithWait, releaseLock, startLockRenewal } from '@/lib/redis-lock';
import { deleteObject, putObject } from '@/modules/oss';

/**
 * Generic object upload capability. Callers (works EPUB, future avatars) supply
 * a spec (allowed extensions / MIME types / size cap / content check / key
 * strategy) — this service validates, stores, and dedupes. Nothing here knows
 * about business tables; dedup bookkeeping lives in `uploaded_object`.
 */

export type UploadSpec = {
  /** Lower-case file extensions without dot, e.g. ['epub']. */
  allowedExtensions: string[];
  /** Case-insensitive MIME whitelist. Empty string (browser unknown type) is always allowed. */
  allowedMimeTypes: string[];
  maxBytes: number;
  /** Optional content-level check — returns an error message when invalid. */
  validateContent?: (body: Buffer) => string | null;
  /** Content-addressed key strategy, e.g. `hash => \`epub/${hash}.epub\``. */
  keyBuilder: (contentHash: string) => string;
};

export type UploadedFileMeta = {
  storageKey: string;
  mimeType: string;
  contentHash: string;
  size: number;
};

export type AcquireUploadedObjectInput =
  | { kind: 'file'; fileName: string; body: Buffer; contentType: string; spec: UploadSpec }
  | { kind: 'hash'; fileName: string; contentHash: string; spec: UploadSpec };

export type AcquireUploadedObjectResult = {
  meta: UploadedFileMeta;
  /** True when the object already existed — caller may skip upload / show instant completion. */
  duplicated: boolean;
};

const uploadLogger = rootLogger.child({ module: 'Uploads' });
const UPLOAD_DEDUPE_LOCK_PREFIX = 'gloaming:upload:dedupe:';
const UPLOAD_DEDUPE_LOCK_TTL_SECONDS = 5 * 60;
const UPLOAD_DEDUPE_LOCK_MAX_WAIT_MS = 30_000;

export function fileExtension(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName);
  return match ? match[1].toLowerCase() : '';
}

export function hashFileContent(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

/** ZIP magic bytes — EPUB files are zip archives. */
export function isZipFile(body: Buffer): boolean {
  return body.length >= 4 && body[0] === 0x50 && body[1] === 0x4b && body[2] === 0x03 && body[3] === 0x04;
}

export function isValidContentHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash);
}

/** Validate a file against the spec without touching storage. Throws AppError on failure. */
export function validateUploadInput(input: { fileName: string; body: Buffer; contentType: string; spec: UploadSpec }): {
  mimeType: string;
} {
  const { fileName, body, contentType, spec } = input;

  const extension = fileExtension(fileName);
  if (!extension || !spec.allowedExtensions.includes(extension)) {
    const labels = spec.allowedExtensions.map((ext) => `.${ext}`).join(' / ');
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.UPLOAD.UNSUPPORTED_FORMAT, { formats: labels });
  }

  const normalizedType = contentType.trim().toLowerCase();
  if (normalizedType && !spec.allowedMimeTypes.includes(normalizedType)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.UPLOAD.UNSUPPORTED_MIME);
  }

  if (body.length > spec.maxBytes) {
    const mb = Math.floor(spec.maxBytes / (1024 * 1024));
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.UPLOAD.FILE_TOO_LARGE, { maxMb: mb });
  }

  if (spec.validateContent) {
    const message = spec.validateContent(body);
    if (message) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.UPLOAD.CONTENT_INVALID, { reason: message });
    }
  }

  return { mimeType: normalizedType || 'application/octet-stream' };
}

export async function findUploadedObjectByHash(contentHash: string): Promise<UploadedFileMeta | null> {
  const [row] = await db
    .select({
      storageKey: uploadedObjectTable.storageKey,
      mimeType: uploadedObjectTable.mimeType,
      size: uploadedObjectTable.size,
    })
    .from(uploadedObjectTable)
    .where(eq(uploadedObjectTable.contentHash, contentHash))
    .limit(1);
  if (!row) {
    return null;
  }
  return { storageKey: row.storageKey, mimeType: row.mimeType, contentHash, size: row.size };
}

async function registerUploadedObject(input: {
  contentHash: string;
  storageKey: string;
  mimeType: string;
  size: number;
}): Promise<boolean> {
  const [registered] = await db
    .insert(uploadedObjectTable)
    .values({
      id: randomUUID(),
      contentHash: input.contentHash,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      size: input.size,
      refCount: 1,
    })
    .onConflictDoNothing()
    .returning({ id: uploadedObjectTable.id });
  return Boolean(registered);
}

/** Atomic increment of the dedup ref count for an existing object. */
async function incrementUploadedObjectRef(contentHash: string): Promise<void> {
  await db
    .update(uploadedObjectTable)
    .set({ refCount: sql`${uploadedObjectTable.refCount} + 1` })
    .where(eq(uploadedObjectTable.contentHash, contentHash));
}

/**
 * Low-level put without dedup bookkeeping. Use `acquireUploadedObject` for
 * content-addressed uploads; this remains for callers that manage keys themselves.
 */
export async function uploadObjectFile(input: {
  key: string;
  fileName: string;
  body: Buffer;
  contentType: string;
  spec: UploadSpec;
}): Promise<UploadedFileMeta> {
  const { key, fileName, body, contentType, spec } = input;
  const { mimeType } = validateUploadInput({ fileName, body, contentType, spec });
  await putObject({ key, body, contentType: mimeType });
  return { storageKey: key, mimeType, contentHash: hashFileContent(body), size: body.length };
}

/**
 * Dedupe-aware upload:
 * - `kind: 'file'` — validate + hash + dedupe. Existing object is reused (ref +1);
 *   otherwise the bytes are stored and registered.
 * - `kind: 'hash'` — reuse path without file bytes (instant upload). Returns null
 *   when the object is unknown so the caller can fall back to a file upload.
 * Returns `duplicated: true` when the object already existed.
 */
export async function acquireUploadedObject(
  input: AcquireUploadedObjectInput,
): Promise<AcquireUploadedObjectResult | null> {
  const { fileName, spec } = input;

  const contentHash = input.kind === 'file' ? hashFileContent(input.body) : input.contentHash;
  if (!isValidContentHash(contentHash)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.UPLOAD.INVALID_HASH);
  }

  const lockKey = `${UPLOAD_DEDUPE_LOCK_PREFIX}${contentHash}`;
  const lockToken = randomUUID();
  const locked = await acquireLockWithWait(lockKey, lockToken, UPLOAD_DEDUPE_LOCK_TTL_SECONDS, {
    maxWaitMs: UPLOAD_DEDUPE_LOCK_MAX_WAIT_MS,
  });
  if (!locked) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.OSS.UNAVAILABLE);
  }

  const lockRenewal = startLockRenewal(lockKey, lockToken, UPLOAD_DEDUPE_LOCK_TTL_SECONDS, {
    maxDurationMs: 15 * 60 * 1_000,
  });

  try {
    // Re-check under the hash lock so concurrent uploads converge on one row.
    const existing = await findUploadedObjectByHash(contentHash);
    if (existing) {
      await incrementUploadedObjectRef(contentHash);
      return { meta: existing, duplicated: true };
    }

    if (input.kind === 'hash') {
      return null;
    }

    const { mimeType } = validateUploadInput({ fileName, body: input.body, contentType: input.contentType, spec });
    const storageKey = spec.keyBuilder(contentHash);

    try {
      await putObject({ key: storageKey, body: input.body, contentType: mimeType });
    } catch (error) {
      uploadLogger.error({ err: error, storageKey }, 'Object store put failed');
      throw error;
    }

    const registered = await registerUploadedObject({ contentHash, storageKey, mimeType, size: input.body.length });
    if (!registered) {
      // The lock should prevent this, but an older writer or a recovered lock
      // may still win the unique constraint. Never delete a possibly shared key.
      const canonical = await findUploadedObjectByHash(contentHash);
      if (canonical) {
        await incrementUploadedObjectRef(contentHash);
        return { meta: canonical, duplicated: true };
      }
      throw new Error(`Uploaded object registration did not create a canonical row for ${contentHash}`);
    }

    return {
      meta: { storageKey, mimeType, contentHash, size: input.body.length },
      duplicated: false,
    };
  } finally {
    lockRenewal.stop();
    try {
      await releaseLock(lockKey, lockToken);
    } catch (error) {
      // The lock has a finite TTL; do not turn a committed upload into a
      // failed request merely because lock cleanup is temporarily unavailable.
      uploadLogger.warn({ err: error, lockKey }, 'Failed to release upload dedupe lock');
    }
  }
}

/**
 * Drop one reference to a registered object. When the last reference is
 * released, the object is deleted from storage. Unknown keys are ignored
 * (callers manage unregistered objects themselves).
 */
export async function releaseUploadedObject(storageKey: string): Promise<void> {
  const [row] = await db
    .select({ id: uploadedObjectTable.id })
    .from(uploadedObjectTable)
    .where(eq(uploadedObjectTable.storageKey, storageKey))
    .limit(1);
  if (!row) {
    return;
  }

  const [updated] = await db
    .update(uploadedObjectTable)
    .set({ refCount: sql`${uploadedObjectTable.refCount} - 1` })
    .where(eq(uploadedObjectTable.id, row.id))
    .returning({ refCount: uploadedObjectTable.refCount });

  const remaining = updated?.refCount ?? 0;
  if (remaining <= 0) {
    await db.delete(uploadedObjectTable).where(eq(uploadedObjectTable.id, row.id));
    await deleteObject(storageKey);
  }
}
