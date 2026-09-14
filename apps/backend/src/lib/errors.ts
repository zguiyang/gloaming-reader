import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { TranslationParams } from '@gloaming/i18n';

import { HTTP_STATUS } from '@/constants';
import { ERROR_CODES, type ErrorCode } from '@/lib/error-codes';

export type ValidationDetail = {
  path: string;
  message?: string;
  code?: ErrorCode | string;
  params?: TranslationParams;
};

export class AppError extends Error {
  constructor(
    public statusCode: ContentfulStatusCode,
    public code: ErrorCode | string,
    public params?: TranslationParams,
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(code: ErrorCode | string, params?: TranslationParams) {
    super(HTTP_STATUS.NOT_FOUND, code, params);
    this.name = 'NotFoundError';
  }
}

export class ValidationFailedError extends AppError {
  constructor(public details: ValidationDetail[]) {
    super(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_FAILED);
    this.name = 'ValidationFailedError';
  }
}
