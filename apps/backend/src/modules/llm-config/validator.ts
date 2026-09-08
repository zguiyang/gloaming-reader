import { zValidator } from '@hono/zod-validator';
import type { Context, ValidationTargets } from 'hono';
import type { ZodType } from 'zod';

import {
  createLlmModelBodySchema,
  createLlmProviderBodySchema,
  llmModelListQuerySchema,
  putLlmAppSettingBodySchema,
  testLlmProviderBodySchema,
  updateLlmModelBodySchema,
  updateLlmProviderBodySchema,
} from '@gloaming/shared/llm';

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

export const validateCreateProvider = validated('json', createLlmProviderBodySchema);
export const validateUpdateProvider = validated('json', updateLlmProviderBodySchema);
export const validateCreateModel = validated('json', createLlmModelBodySchema);
export const validateUpdateModel = validated('json', updateLlmModelBodySchema);
export const validateModelListQuery = validated('query', llmModelListQuerySchema);
export const validatePutSetting = validated('json', putLlmAppSettingBodySchema);
export const validateTestProvider = validated('json', testLlmProviderBodySchema);
