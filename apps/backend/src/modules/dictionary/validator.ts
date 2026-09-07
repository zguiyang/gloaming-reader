import { zValidator } from '@hono/zod-validator';
import type { Context, ValidationTargets } from 'hono';
import type { ZodType } from 'zod';

import {
  lookupDictionaryQuerySchema,
  putDictionaryConfigBodySchema,
  testDictionaryBodySchema,
} from '@gloaming/shared/dictionary';

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

export const validatePutDictionaryConfig = validated('json', putDictionaryConfigBodySchema);
export const validateTestDictionary = validated('json', testDictionaryBodySchema);
export const validateLookupDictionaryQuery = validated('query', lookupDictionaryQuerySchema);
