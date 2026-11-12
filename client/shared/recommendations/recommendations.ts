import { z } from 'zod';

import { emptyToUndefined } from '../pagination/index.ts';
import { workSchema } from '../works/index.ts';

/** Frontend may request fewer; API clamps into this inclusive range. */
export const RECOMMENDATION_LIMIT_MIN = 1 as const;
export const RECOMMENDATION_LIMIT_MAX = 10 as const;
/** Default when `limit` is omitted. */
export const RECOMMENDATION_LIMIT_DEFAULT = 4 as const;

export const RECOMMENDATION_STRATEGIES = ['current', 'shelf_profile', 'cold_start'] as const;
export type RecommendationStrategy = (typeof RECOMMENDATION_STRATEGIES)[number];

/** Clamp a raw limit into the allowed API range. */
export function clampRecommendationLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return RECOMMENDATION_LIMIT_DEFAULT;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return RECOMMENDATION_LIMIT_DEFAULT;
  }
  return Math.min(RECOMMENDATION_LIMIT_MAX, Math.max(RECOMMENDATION_LIMIT_MIN, Math.trunc(n)));
}

export const recommendationsQuerySchema = z.object({
  limit: z.preprocess(
    clampRecommendationLimit,
    z.number().int().min(RECOMMENDATION_LIMIT_MIN).max(RECOMMENDATION_LIMIT_MAX),
  ),
  excludeWorkId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

export type RecommendationsQuery = z.infer<typeof recommendationsQuerySchema>;

export const recommendationsDataSchema = z.object({
  strategy: z.enum(RECOMMENDATION_STRATEGIES),
  anchorWorkId: z.string().nullable(),
  items: z.array(workSchema).max(RECOMMENDATION_LIMIT_MAX),
});

export type RecommendationsData = z.infer<typeof recommendationsDataSchema>;
