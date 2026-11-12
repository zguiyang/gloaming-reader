import { z } from 'zod';

export const translatePartBodySchema = z.object({
  partId: z.string().min(1),
});

export type TranslatePartBody = z.infer<typeof translatePartBodySchema>;

/** SSE `event:` names for POST /api/translate/part */
export const TRANSLATE_SSE_EVENT = {
  meta: 'meta',
  title: 'title',
  sentence: 'sentence',
  done: 'done',
  error: 'error',
} as const;

export type TranslateSseEventName = (typeof TRANSLATE_SSE_EVENT)[keyof typeof TRANSLATE_SSE_EVENT];

export const translateSentenceEnSchema = z.object({
  index: z.number().int().nonnegative(),
  paragraphIndex: z.number().int().nonnegative(),
  en: z.string().min(1),
});

export type TranslateSentenceEn = z.infer<typeof translateSentenceEnSchema>;

export const translateSseMetaSchema = z.object({
  contentHash: z.string().min(1),
  titleEn: z.string(),
  sentences: z.array(translateSentenceEnSchema),
});

export type TranslateSseMeta = z.infer<typeof translateSseMetaSchema>;

export const translateSseTitleSchema = z.object({
  zh: z.string().min(1),
});

export type TranslateSseTitle = z.infer<typeof translateSseTitleSchema>;

export const translateSseSentenceSchema = z.object({
  index: z.number().int().nonnegative(),
  zh: z.string().min(1),
});

export type TranslateSseSentence = z.infer<typeof translateSseSentenceSchema>;

export const translateSseDoneSchema = z.object({
  contentHash: z.string().min(1),
  cached: z.boolean(),
});

export type TranslateSseDone = z.infer<typeof translateSseDoneSchema>;

export const translateSseErrorSchema = z.object({
  error: z.string(),
});

export type TranslateSseError = z.infer<typeof translateSseErrorSchema>;

/** Full bilingual payload stored in Redis (and assembled after a successful stream). */
export const bilingualCachePayloadSchema = z.object({
  titleEn: z.string(),
  titleZh: z.string().min(1),
  sentences: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      paragraphIndex: z.number().int().nonnegative(),
      en: z.string().min(1),
      zh: z.string().min(1),
    }),
  ),
});

export type BilingualCachePayload = z.infer<typeof bilingualCachePayloadSchema>;
