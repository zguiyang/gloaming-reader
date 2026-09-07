import { z } from 'zod';

import {
  createSortByQuerySchema,
  emptyToUndefined,
  paginationMetaSchema,
  paginationQuerySchema,
} from '../pagination/index.ts';
import { ttsVoiceRoleValues } from '../tts/index.ts';

export const TTS_INVOCATION_STATUSES = ['success', 'failure'] as const;
export type TtsInvocationStatus = (typeof TTS_INVOCATION_STATUSES)[number];

export const TTS_INVOCATION_SORT_FIELDS = ['createdAt'] as const;
export type TtsInvocationSortField = (typeof TTS_INVOCATION_SORT_FIELDS)[number];
export const DEFAULT_TTS_INVOCATION_SORT_BY = 'createdAt' as const satisfies TtsInvocationSortField;

export const TTS_INVOCATION_DEFAULT_PAGE_SIZE = 10 as const;
export const TTS_INVOCATION_STATS_DAYS = 30 as const;
export const TTS_INVOCATION_PRESET_DAYS = [3, 7, 15, 30] as const;
export type TtsInvocationPresetDays = (typeof TTS_INVOCATION_PRESET_DAYS)[number];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function ttsInvocationWindowForDays(days: number, now = new Date()): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - days * MS_PER_DAY),
    to: now,
  };
}

export function resolveTtsInvocationWindow(
  input: { from?: Date; to?: Date },
  now = new Date(),
): { from: Date; to: Date } {
  if (input.from && input.to) {
    return { from: input.from, to: input.to };
  }
  if (input.from) {
    return { from: input.from, to: now };
  }
  if (input.to) {
    return { from: new Date(input.to.getTime() - TTS_INVOCATION_STATS_DAYS * MS_PER_DAY), to: input.to };
  }
  return ttsInvocationWindowForDays(TTS_INVOCATION_STATS_DAYS, now);
}

const queryDateSchema = z.preprocess(
  (value) => {
    const emptied = emptyToUndefined(value);
    if (emptied === undefined) {
      return undefined;
    }
    if (emptied instanceof Date) {
      return emptied;
    }
    return new Date(String(emptied));
  },
  z
    .date()
    .refine((date) => Number.isFinite(date.getTime()), { message: 'Invalid date' })
    .optional(),
);

const invocationStatusQuerySchema = z.preprocess(emptyToUndefined, z.enum(TTS_INVOCATION_STATUSES).optional());

function refineInvocationRange(query: { from?: Date; to?: Date }, ctx: z.RefinementCtx) {
  if (query.from && query.to && query.from.getTime() > query.to.getTime()) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'to must be on or after from',
    });
  }
}

export const ttsInvocationStatsQuerySchema = z
  .object({
    from: queryDateSchema,
    to: queryDateSchema,
    status: invocationStatusQuerySchema,
  })
  .superRefine(refineInvocationRange);

export type TtsInvocationStatsQuery = z.infer<typeof ttsInvocationStatsQuerySchema>;

export const ttsInvocationListQuerySchema = paginationQuerySchema
  .extend({
    pageSize: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).default(TTS_INVOCATION_DEFAULT_PAGE_SIZE)),
    sortBy: createSortByQuerySchema(TTS_INVOCATION_SORT_FIELDS, DEFAULT_TTS_INVOCATION_SORT_BY),
    from: queryDateSchema,
    to: queryDateSchema,
    status: invocationStatusQuerySchema,
    partId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  })
  .superRefine(refineInvocationRange);

export type TtsInvocationListQuery = z.infer<typeof ttsInvocationListQuerySchema>;

export const ttsInvocationLogSchema = z.object({
  id: z.string(),
  createdAt: z.union([z.string(), z.date()]),
  status: z.enum(TTS_INVOCATION_STATUSES),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  source: z.string(),
  userId: z.string().nullable(),
  workId: z.string().nullable(),
  partId: z.string().nullable(),
  partTitle: z.string().nullable(),
  voice: z.string().nullable(),
  role: z.enum(ttsVoiceRoleValues).nullable(),
  textPreview: z.string().nullable(),
  textLength: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  cached: z.boolean().nullable(),
});

export type TtsInvocationLog = z.infer<typeof ttsInvocationLogSchema>;

export const ttsInvocationListDataSchema = z.object({
  items: z.array(ttsInvocationLogSchema),
  pagination: paginationMetaSchema,
});

export type TtsInvocationListData = z.infer<typeof ttsInvocationListDataSchema>;

export const ttsInvocationStatsSchema = z.object({
  from: z.union([z.string(), z.date()]),
  to: z.union([z.string(), z.date()]),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
});

export type TtsInvocationStats = z.infer<typeof ttsInvocationStatsSchema>;
