import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

export const EPUB_ERROR_CODES = {
  INVALID_ARCHIVE: 'EPUB_INVALID_ARCHIVE',
  INVALID_STRUCTURE: 'EPUB_INVALID_STRUCTURE',
  RESOURCE_LIMIT_EXCEEDED: 'EPUB_RESOURCE_LIMIT_EXCEEDED',
} as const;

export const EPUB_RESOURCE_LIMITS = {
  maxCompressedBytes: EPUB_UPLOAD_MAX_BYTES,
  maxEntries: 10_000,
  maxSingleUncompressedBytes: 32 * 1024 * 1024,
  maxTotalUncompressedBytes: 128 * 1024 * 1024,
} as const;

export class EpubValidationError extends Error {
  constructor(
    public readonly code: (typeof EPUB_ERROR_CODES)[keyof typeof EPUB_ERROR_CODES],
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'EpubValidationError';
  }
}

export class EpubResourceLimitError extends EpubValidationError {
  constructor(message: string) {
    super(EPUB_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED, message);
    this.name = 'EpubResourceLimitError';
  }
}

export function isEpubValidationError(error: unknown): error is EpubValidationError {
  return error instanceof EpubValidationError;
}
