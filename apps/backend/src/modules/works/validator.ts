import { zValidator } from '@hono/zod-validator';
import type { Context, ValidationTargets } from 'hono';
import type { ZodType } from 'zod';

import {
  adminWorkListQuerySchema,
  catalogListQuerySchema,
  checkEpubWorkReuseBodySchema,
  createAdminTextWorkBodySchema,
  retryWorkflowBodySchema,
  updateWorkBodySchema,
} from '@gloaming/shared/works';

import { sendValidationError } from '@/lib/response';

function validated<T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c: Context) => {
    if (!result.success) {
      return sendValidationError(
        c,
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
  });
}

export const validateCreateAdminTextWork = validated('json', createAdminTextWorkBodySchema);
export const validateCheckEpubWorkReuse = validated('json', checkEpubWorkReuseBodySchema);
export const validateUpdateWork = validated('json', updateWorkBodySchema);
export const validateRetryWorkflow = validated('json', retryWorkflowBodySchema);
export const validateAdminWorkListQuery = validated('query', adminWorkListQuerySchema);
export const validateCatalogListQuery = validated('query', catalogListQuerySchema);
