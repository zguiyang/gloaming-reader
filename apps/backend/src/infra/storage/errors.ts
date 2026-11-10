import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

/**
 * The requested byte range lies outside the object (S3 `416 InvalidRange`).
 * Carries the object size when known so callers can answer with the standard
 * wildcard `Content-Range` (`bytes *` … `<size>`) header; `null` when the
 * provider did not report one.
 */
export class RangeNotSatisfiableError extends AppError {
  constructor(public readonly objectSize: number | null = null) {
    super(HTTP_STATUS.RANGE_NOT_SATISFIABLE, ERROR_CODES.OSS.RANGE_NOT_SATISFIABLE);
    this.name = 'RangeNotSatisfiableError';
  }
}
