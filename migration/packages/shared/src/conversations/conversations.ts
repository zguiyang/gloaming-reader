import { z } from 'zod';

import {
  buildPaginationMeta,
  createSortByQuerySchema,
  emptyToUndefined,
  paginationMetaSchema,
  paginationQuerySchema,
} from '../pagination/index.ts';

export const CONVERSATION_SURFACES = ['assist-read'] as const;
export type ConversationSurface = (typeof CONVERSATION_SURFACES)[number];

export const CONVERSATION_SUBJECT_TYPES = ['reading_work'] as const;
export type ConversationSubjectType = (typeof CONVERSATION_SUBJECT_TYPES)[number];

export const CONVERSATION_MESSAGE_ROLES = ['user', 'assistant'] as const;
export type ConversationMessageRole = (typeof CONVERSATION_MESSAGE_ROLES)[number];

export const CONVERSATION_MESSAGE_STATUSES = ['complete', 'failed', 'aborted'] as const;
export type ConversationMessageStatus = (typeof CONVERSATION_MESSAGE_STATUSES)[number];

export const CONVERSATION_PREVIEW_MAX = 80 as const;
export const CONVERSATION_CONTENT_MAX = 32_000 as const;
export const CONVERSATION_DETAIL_MESSAGE_CAP = 500 as const;

export const CONVERSATION_SORT_FIELDS = ['lastMessageAt'] as const;
export type ConversationSortField = (typeof CONVERSATION_SORT_FIELDS)[number];
export const DEFAULT_CONVERSATION_SORT_BY = 'lastMessageAt' as const satisfies ConversationSortField;

export const conversationMessageMetadataSchema = z
  .object({
    actionId: z.string().min(1).optional(),
    selection: z.string().optional(),
    question: z.string().optional(),
    suggestions: z.array(z.string().min(1).max(48)).max(3).optional(),
    invocationLogId: z.string().min(1).optional(),
  })
  .strict();

export type ConversationMessageMetadataDto = z.infer<typeof conversationMessageMetadataSchema>;

export const conversationSummarySchema = z.object({
  id: z.string(),
  surface: z.enum(CONVERSATION_SURFACES),
  subjectType: z.enum(CONVERSATION_SUBJECT_TYPES),
  subjectId: z.string(),
  preview: z.string(),
  endedAt: z.union([z.string(), z.date()]).nullable(),
  lastMessageAt: z.union([z.string(), z.date()]),
  createdAt: z.union([z.string(), z.date()]),
});

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationMessageSchema = z.object({
  id: z.string(),
  role: z.enum(CONVERSATION_MESSAGE_ROLES),
  content: z.string(),
  status: z.enum(CONVERSATION_MESSAGE_STATUSES),
  metadata: conversationMessageMetadataSchema,
  createdAt: z.union([z.string(), z.date()]),
});

export type ConversationMessageDto = z.infer<typeof conversationMessageSchema>;

export const conversationDetailSchema = conversationSummarySchema.extend({
  messages: z.array(conversationMessageSchema),
});

export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const createConversationBodySchema = z.object({
  surface: z.enum(CONVERSATION_SURFACES),
  subjectType: z.enum(CONVERSATION_SUBJECT_TYPES),
  subjectId: z.string().min(1),
});

export type CreateConversationBody = z.infer<typeof createConversationBodySchema>;

const subjectTypeQuerySchema = z.preprocess(emptyToUndefined, z.enum(CONVERSATION_SUBJECT_TYPES).optional());

const subjectIdQuerySchema = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());

const surfaceQuerySchema = z.preprocess(emptyToUndefined, z.enum(CONVERSATION_SURFACES).optional());

/** Query for `GET /api/conversations` (pagination + optional scope filters). */
export const conversationListQuerySchema = paginationQuerySchema
  .extend({
    sortBy: createSortByQuerySchema(CONVERSATION_SORT_FIELDS, DEFAULT_CONVERSATION_SORT_BY),
    surface: surfaceQuerySchema,
    subjectType: subjectTypeQuerySchema,
    subjectId: subjectIdQuerySchema,
  })
  .superRefine((query, ctx) => {
    const hasType = query.subjectType != null;
    const hasId = query.subjectId != null;
    if (hasType !== hasId) {
      ctx.addIssue({
        code: 'custom',
        path: hasType ? ['subjectId'] : ['subjectType'],
        message: 'subjectType and subjectId must be provided together',
      });
    }
  });

export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

export const conversationListDataSchema = z.object({
  items: z.array(conversationSummarySchema),
  pagination: paginationMetaSchema,
});

export type ConversationListData = z.infer<typeof conversationListDataSchema>;

export { buildPaginationMeta };
