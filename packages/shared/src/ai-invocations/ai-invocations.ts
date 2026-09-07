import { z } from 'zod';

import {
  createSortByQuerySchema,
  emptyToUndefined,
  paginationMetaSchema,
  paginationQuerySchema,
} from '../pagination/index.ts';

export const AI_INVOCATION_STATUSES = ['success', 'failure'] as const;
export type AiInvocationStatus = (typeof AI_INVOCATION_STATUSES)[number];

export const AI_INVOCATION_SORT_FIELDS = ['createdAt'] as const;
export type AiInvocationSortField = (typeof AI_INVOCATION_SORT_FIELDS)[number];
export const DEFAULT_AI_INVOCATION_SORT_BY = 'createdAt' as const satisfies AiInvocationSortField;

export const AI_INVOCATION_DEFAULT_PAGE_SIZE = 10 as const;
export const AI_INVOCATION_STATS_DAYS = 30 as const;
export const AI_INVOCATION_PRESET_DAYS = [3, 7, 15, 30] as const;
export type AiInvocationPresetDays = (typeof AI_INVOCATION_PRESET_DAYS)[number];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function aiInvocationWindowForDays(days: number, now = new Date()): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - days * MS_PER_DAY),
    to: now,
  };
}

export function resolveAiInvocationWindow(
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
    return { from: new Date(input.to.getTime() - AI_INVOCATION_STATS_DAYS * MS_PER_DAY), to: input.to };
  }
  return aiInvocationWindowForDays(AI_INVOCATION_STATS_DAYS, now);
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

const invocationStatusQuerySchema = z.preprocess(emptyToUndefined, z.enum(AI_INVOCATION_STATUSES).optional());

function refineInvocationRange(query: { from?: Date; to?: Date }, ctx: z.RefinementCtx) {
  if (query.from && query.to && query.from.getTime() > query.to.getTime()) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'to must be on or after from',
    });
  }
}

export const aiInvocationStatsQuerySchema = z
  .object({
    from: queryDateSchema,
    to: queryDateSchema,
    status: invocationStatusQuerySchema,
  })
  .superRefine(refineInvocationRange);

export type AiInvocationStatsQuery = z.infer<typeof aiInvocationStatsQuerySchema>;

export const aiInvocationListQuerySchema = paginationQuerySchema
  .extend({
    pageSize: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).default(AI_INVOCATION_DEFAULT_PAGE_SIZE)),
    sortBy: createSortByQuerySchema(AI_INVOCATION_SORT_FIELDS, DEFAULT_AI_INVOCATION_SORT_BY),
    from: queryDateSchema,
    to: queryDateSchema,
    status: invocationStatusQuerySchema,
  })
  .superRefine(refineInvocationRange);

export type AiInvocationListQuery = z.infer<typeof aiInvocationListQuerySchema>;

export const aiInvocationRequestSummarySchema = z.object({
  messageCount: z.number().int().optional(),
  selectionPreview: z.string().optional(),
  selectionLength: z.number().int().optional(),
  toolNames: z.array(z.string()).optional(),
  toolRoundCount: z.number().int().optional(),
  actionId: z.string().optional(),
  phase: z.string().optional(),
});

export type AiInvocationRequestSummaryDto = z.infer<typeof aiInvocationRequestSummarySchema>;

export const aiInvocationResponseSummarySchema = z.object({
  replyPreview: z.string().optional(),
  replyLength: z.number().int().optional(),
});

export type AiInvocationResponseSummaryDto = z.infer<typeof aiInvocationResponseSummarySchema>;

export const aiInvocationLogSchema = z.object({
  id: z.string(),
  createdAt: z.union([z.string(), z.date()]),
  status: z.enum(AI_INVOCATION_STATUSES),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  purpose: z.string().nullable(),
  source: z.string(),
  userId: z.string().nullable(),
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  modelRowId: z.string().nullable(),
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
  baseUrl: z.string().nullable(),
  latencyMs: z.number().int().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  totalTokens: z.number().int().nullable(),
  costAmount: z.number().nullable(),
  costCurrency: z.string().nullable(),
  requestSummary: aiInvocationRequestSummarySchema.nullable(),
  responseSummary: aiInvocationResponseSummarySchema.nullable(),
});

export type AiInvocationLog = z.infer<typeof aiInvocationLogSchema>;

export const aiInvocationListDataSchema = z.object({
  items: z.array(aiInvocationLogSchema),
  pagination: paginationMetaSchema,
});

export type AiInvocationListData = z.infer<typeof aiInvocationListDataSchema>;

export const aiInvocationStatsSchema = z.object({
  from: z.union([z.string(), z.date()]),
  to: z.union([z.string(), z.date()]),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costAmount: z.number(),
  costCurrency: z.string().nullable(),
});

export type AiInvocationStats = z.infer<typeof aiInvocationStatsSchema>;
