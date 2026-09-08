import { zValidator } from '@hono/zod-validator';
import type { Context, ValidationTargets } from 'hono';
import type { ZodType } from 'zod';

import {
  generatePartAudioBodySchema,
  generateWorkAudioBodySchema,
  workAudioQuerySchema,
} from '@gloaming/shared/content-assets';

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

export const validateGeneratePartAudio = validated('json', generatePartAudioBodySchema);
export const validateGenerateWorkAudio = validated('json', generateWorkAudioBodySchema);
export const validateWorkAudioQuery = validated('query', workAudioQuerySchema);
