import { zValidator } from '@hono/zod-validator';
import type { Context, ValidationTargets } from 'hono';
import type { ZodType } from 'zod';

import { discoverySourceEnabledUpdateSchema, sourceRecordListQuerySchema } from '@gloaming/shared/discovery';

import { sendValidationError } from '@/infra/http/response';

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

export const validateSourceRecordListQuery = validated('query', sourceRecordListQuerySchema);

export const validateSourceEnabledUpdate = validated('json', discoverySourceEnabledUpdateSchema);
