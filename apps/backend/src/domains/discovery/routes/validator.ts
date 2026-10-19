import { zValidator } from '@hono/zod-validator';
import type { Context, ValidationTargets } from 'hono';
import { z, type ZodType } from 'zod';

import { SUPPORTED_LOCALES } from '@gloaming/i18n';
import {
  categorySourceRecordListQuerySchema,
  discoverySourceEnabledUpdateSchema,
  publicCategoryWriteSchema,
  sourceRecordListQuerySchema,
} from '@gloaming/shared/discovery';

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

export const validateCategorySourceRecordListQuery = validated('query', categorySourceRecordListQuerySchema);

/**
 * Admin candidate search over every SourceRecord. It shares the category
 * assignment query shape (search, sort, pagination) and deliberately drops the
 * public content-language and category filters.
 */
export const validateAdminSourceRecordListQuery = validated('query', categorySourceRecordListQuerySchema);

export const validateSourceEnabledUpdate = validated('json', discoverySourceEnabledUpdateSchema);

/**
 * Optional body of the manual sync trigger. A request without a JSON body
 * validates to `{}` and keeps the original conditional behavior; only the
 * literal `force: true` opts into a full refresh, any other value fails here
 * with the standard validation-error contract. Unknown keys are stripped,
 * mirroring the enabled-toggle body handling.
 */
const discoverySyncTriggerSchema = z.object({
  force: z.boolean().optional(),
});

/** Validates the optional `{force?: boolean}` body of `POST .../sync`. */
export const validateDiscoverySyncTrigger = validated('json', discoverySyncTriggerSchema);

/**
 * Admin category writes always carry one supported locale: a label belongs to
 * exactly one of the product's supported locales.
 */
const managedCategoryWriteSchema = publicCategoryWriteSchema.extend({
  locale: z.enum(SUPPORTED_LOCALES),
});

export const validateManagedCategoryWrite = validated('json', managedCategoryWriteSchema);
