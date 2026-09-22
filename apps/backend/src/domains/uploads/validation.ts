import { createHash } from 'node:crypto';

import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

/**
 * Caller-defined upload constraints. Works EPUB, future avatars, etc. supply
 * extensions, MIME whitelist, size cap, optional content check, and key strategy.
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
