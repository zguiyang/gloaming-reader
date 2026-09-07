import { zValidator } from '@hono/zod-validator';
import type { Context, ValidationTargets } from 'hono';
import type { ZodType } from 'zod';

import { putTtsConfigBodySchema, testTtsBodySchema } from '@gloaming/shared';
import { ttsInvocationListQuerySchema, ttsInvocationStatsQuerySchema } from '@gloaming/shared/tts-invocations';

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

export const validatePutTtsConfig = validated('json', putTtsConfigBodySchema);
export const validateTestTts = validated('json', testTtsBodySchema);
export const validateTtsInvocationListQuery = validated('query', ttsInvocationListQuerySchema);
export const validateTtsInvocationStatsQuery = validated('query', ttsInvocationStatsQuerySchema);
