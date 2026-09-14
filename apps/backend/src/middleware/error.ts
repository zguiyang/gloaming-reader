import type { Context } from 'hono';
import { ZodError } from 'zod';

import { HTTP_STATUS } from '@/constants';
import { ERROR_CODES } from '@/lib/error-codes';
import { AppError, ValidationFailedError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import { sendError, sendValidationError } from '@/lib/response';

export const errorHandler = (err: Error, c: Context) => {
  if (err instanceof ValidationFailedError) {
    return sendValidationError(c, err.details);
  }

  if (err instanceof AppError) {
    return sendError(c, err.code, err.statusCode, err.params);
  }

  if (err instanceof ZodError) {
    return sendValidationError(
      c,
      err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  rootLogger.error({ err }, 'Unhandled error');
  return sendError(c, ERROR_CODES.INTERNAL_SERVER_ERROR, HTTP_STATUS.INTERNAL_ERROR);
};
