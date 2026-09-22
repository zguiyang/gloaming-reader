import { randomUUID } from 'node:crypto';

import {
  findUploadedObjectByHash,
  incrementUploadedObjectRef,
  registerUploadedObject,
  type UploadedFileMeta,
} from '@/domains/uploads/registry';
import { storeValidatedUpload } from '@/domains/uploads/storage';
import {
  hashFileContent,
  isValidContentHash,
  type UploadSpec,
  validateUploadInput,
} from '@/domains/uploads/validation';
import { acquireLockWithWait, releaseLock, startLockRenewal } from '@/infra/cache/lock';
import { rootLogger } from '@/infra/logging/logger';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

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
      await storeValidatedUpload({ storageKey, body: input.body, mimeType });
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
