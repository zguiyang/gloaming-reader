import { z } from 'zod';

import {
  buildPaginationMeta,
  createSortByQuerySchema,
  emptyToUndefined,
  paginationMetaSchema,
  paginationQuerySchema,
} from '../pagination/index.ts';
import { DIFFICULTY_SCORE_MAX, DIFFICULTY_SCORE_MIN, WORK_STATS_PROVENANCES } from '../reading-stats/index.ts';
import { sourceReferenceSchema, taxonomyReferenceSchema } from '../taxonomy/taxonomy.ts';
import { catalogCategoryIdQuerySchema, catalogTagIdsQuerySchema } from './catalog-query.ts';

/** ReadingWork pipeline processing statuses (publication is `publishedAt`, not a processing value). */
export const WORK_PROCESSING_STATUSES = ['uploaded', 'processing', 'parsed', 'metadata', 'ready', 'failed'] as const;
export type WorkProcessingStatus = (typeof WORK_PROCESSING_STATUSES)[number];
export const workProcessingStatusSchema = z.enum(WORK_PROCESSING_STATUSES);
export const WORK_PROCESSING_STATUS_LABELS = {
  uploaded: 'Uploaded',
  processing: 'Processing',
  parsed: 'Parsed',
  metadata: 'Metadata',
  ready: 'Ready',
  failed: 'Failed',
} as const satisfies Record<WorkProcessingStatus, string>;

export const WORK_VISIBILITIES = ['catalog', 'private'] as const;
export type WorkVisibility = (typeof WORK_VISIBILITIES)[number];
export const workVisibilitySchema = z.enum(WORK_VISIBILITIES);
export const WORK_VISIBILITY_LABELS = {
  catalog: 'Catalog',
  private: 'Private',
} as const satisfies Record<WorkVisibility, string>;

export const PART_KINDS = ['chapter', 'body', 'section', 'segment'] as const;
export type PartKind = (typeof PART_KINDS)[number];
export const partKindSchema = z.enum(PART_KINDS);
export const PART_KIND_LABELS = {
  chapter: 'Chapter',
  body: 'Body',
  section: 'Section',
  segment: 'Segment',
} as const satisfies Record<PartKind, string>;

export const WORK_TITLE_MAX = 200 as const;
/** Max HTML body chars per part — markup inflates plain text ~1.5-2x. */
export const PART_BODY_MAX_CHARS = 1_500_000 as const;

/** Max EPUB upload size (bytes) — enforced by frontend and backend. */
export const EPUB_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

/** Public work JSON (catalog / discover — no parts body). */
export const workSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  description: z.string(),
  language: z.string(),
  processingStatus: workProcessingStatusSchema,
  visibility: workVisibilitySchema,
  tags: z.array(taxonomyReferenceSchema),
  category: taxonomyReferenceSchema.nullable(),
  /** Channel providers (e.g. Project Gutenberg) — auto-filled from EPUB / taxonomy. */
  sources: z.array(sourceReferenceSchema),
  coverAssetId: z.string().nullable(),
  wordCount: z.number().int().nonnegative().nullable(),
  estimatedMinutes: z.number().int().nonnegative().nullable(),
  suggestedVocabSize: z.number().int().positive().nullable(),
  difficultyScore: z.number().int().min(DIFFICULTY_SCORE_MIN).max(DIFFICULTY_SCORE_MAX).nullable(),
  statsProvenance: z.enum(WORK_STATS_PROVENANCES).nullable(),
  publishedAt: z.union([z.string(), z.date()]).nullable(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export type Work = z.infer<typeof workSchema>;

export const partSchema = z.object({
  id: z.string(),
  workId: z.string(),
  sortOrder: z.number().int(),
  kind: partKindSchema,
  title: z.string(),
  body: z.string(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export type Part = z.infer<typeof partSchema>;

/** Compact part summary (no body) for reader navigation. */
export const partSummarySchema = partSchema.omit({ body: true }).extend({
  wordCount: z.number().int().nonnegative().nullable(),
  estimatedMinutes: z.number().int().nonnegative().nullable(),
});

export type PartSummary = z.infer<typeof partSummarySchema>;

/** Safe Personal API response; source storage keys and workflow tokens are intentionally omitted. */
export const personalWorkUploadResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  processingStatus: workProcessingStatusSchema,
});
export type PersonalWorkUploadResult = z.infer<typeof personalWorkUploadResultSchema>;

/** Owner-editable metadata only; lifecycle, ownership, and storage fields are excluded. */
export const personalWorkUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(WORK_TITLE_MAX).optional(),
    author: z.string().trim().max(500).optional(),
    description: z.string().trim().max(5000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one editable field is required');

export const personalWorkUpdateResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  description: z.string(),
});

export const personalWorkDeleteResultSchema = z.object({ id: z.string(), deleted: z.literal(true) });
export type PersonalWorkUpdate = z.infer<typeof personalWorkUpdateSchema>;
export type PersonalWorkUpdateResult = z.infer<typeof personalWorkUpdateResultSchema>;
export type PersonalWorkDeleteResult = z.infer<typeof personalWorkDeleteResultSchema>;

export const CATALOG_SORT_FIELDS = ['publishedAt', 'updatedAt', 'createdAt'] as const;
export type CatalogSortField = (typeof CATALOG_SORT_FIELDS)[number];
export const DEFAULT_CATALOG_SORT_BY = 'publishedAt' as const satisfies CatalogSortField;

const catalogSearchQuerySchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).max(WORK_TITLE_MAX).optional(),
);

/** Query for `GET /api/catalog/works`. */
export const catalogListQuerySchema = paginationQuerySchema.extend({
  sortBy: createSortByQuerySchema(CATALOG_SORT_FIELDS, DEFAULT_CATALOG_SORT_BY),
  category: catalogCategoryIdQuerySchema,
  tag: catalogTagIdsQuerySchema,
  q: catalogSearchQuerySchema,
});

export type CatalogListQuery = z.infer<typeof catalogListQuerySchema>;

/**
 * Catalog list row — includes `partCount` so discover cards can show chapter
 * counts without shipping part bodies.
 */
export const catalogWorkSchema = workSchema.extend({
  partCount: z.number().int().nonnegative(),
});

export type CatalogWork = z.infer<typeof catalogWorkSchema>;

export const catalogListDataSchema = z.object({
  items: z.array(catalogWorkSchema),
  pagination: paginationMetaSchema,
});

export type CatalogListData = z.infer<typeof catalogListDataSchema>;

export { buildPaginationMeta };
