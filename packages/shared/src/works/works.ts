import { z } from 'zod';

import {
  buildPaginationMeta,
  createSortByQuerySchema,
  emptyToUndefined,
  paginationMetaSchema,
  paginationQuerySchema,
} from '../pagination/index.ts';
import { DIFFICULTY_SCORE_MAX, DIFFICULTY_SCORE_MIN, WORK_STATS_PROVENANCES } from '../reading-stats/index.ts';

/** Work lifecycle statuses. */
export const WORK_STATUSES = [
  'uploaded',
  'processing',
  'parsed',
  'metadata',
  'tts',
  'ready',
  'failed',
  'published',
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const workStatusSchema = z.enum(WORK_STATUSES);
export const WORK_STATUS_LABELS = {
  uploaded: 'Uploaded',
  processing: 'Processing',
  parsed: 'Parsed',
  metadata: 'Metadata',
  tts: 'Audio',
  ready: 'Ready',
  failed: 'Failed',
  published: 'Published',
} as const satisfies Record<WorkStatus, string>;

/** Linear generation steps of the EPUB work pipeline (retry/re-run target). */
export const WORKFLOW_STEPS = ['parse', 'metadata', 'tts'] as const;
export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];

export const WORK_VISIBILITIES = ['catalog', 'private'] as const;
export type WorkVisibility = (typeof WORK_VISIBILITIES)[number];
export const workVisibilitySchema = z.enum(WORK_VISIBILITIES);
export const WORK_VISIBILITY_LABELS = {
  catalog: 'Catalog',
  private: 'Private',
} as const satisfies Record<WorkVisibility, string>;

export const WORK_ORIGIN_KINDS = ['admin_text', 'admin_epub'] as const;
export type WorkOriginKind = (typeof WORK_ORIGIN_KINDS)[number];
export const workOriginKindSchema = z.enum(WORK_ORIGIN_KINDS);
export const WORK_ORIGIN_KIND_LABELS = {
  admin_text: 'Admin text',
  admin_epub: 'Admin EPUB',
} as const satisfies Record<WorkOriginKind, string>;

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
export const WORK_AUTHOR_MAX = 200 as const;
export const WORK_DESCRIPTION_MAX = 2000 as const;
export const WORK_TAG_MAX_ITEMS = 10 as const;
export const WORK_TAG_MAX_LEN = 40 as const;
/** Max structured source names on a work (manual fill). */
export const WORK_SOURCE_MAX_ITEMS = 10 as const;
/** Max category name on a work (AI / manual fill). */
export const WORK_CATEGORY_MAX = 100 as const;
/** Max HTML body chars per part — markup inflates plain text ~1.5-2x. */
export const PART_BODY_MAX_CHARS = 1_500_000 as const;

/** Max EPUB upload size (bytes) — enforced by frontend and backend. */
export const EPUB_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export const WORK_METADATA_PROVENANCES = ['extracted', 'ai', 'manual'] as const;
export type WorkMetadataProvenance = (typeof WORK_METADATA_PROVENANCES)[number];

const tagItemSchema = z.string().trim().min(1).max(WORK_TAG_MAX_LEN);
const tagsSchema = z.array(tagItemSchema).max(WORK_TAG_MAX_ITEMS);
const sourceItemSchema = z.string().trim().min(1).max(200);
const sourcesSchema = z.array(sourceItemSchema).max(WORK_SOURCE_MAX_ITEMS);

/** Public work JSON (catalog / discover — no parts body). */
export const workSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  description: z.string(),
  language: z.string(),
  status: workStatusSchema,
  visibility: workVisibilitySchema,
  originKind: workOriginKindSchema,
  tags: z.array(z.string()),
  /** Channel providers (e.g. Project Gutenberg) — auto-filled from EPUB / taxonomy. */
  sources: z.array(z.string()),
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

export const DERIVED_KINDS = ['audio'] as const;
export type DerivedKind = (typeof DERIVED_KINDS)[number];

export const DERIVED_STATES = ['missing', 'fresh', 'stale'] as const;
export type DerivedState = (typeof DERIVED_STATES)[number];

export const derivedFreshnessSchema = z.object({
  audio: z.enum(DERIVED_STATES),
});

export type DerivedFreshness = z.infer<typeof derivedFreshnessSchema>;

/** Origin file asset summary (EPUB upload) — surfaced in the admin workflow. */
export const adminOriginAssetSchema = z.object({
  fileName: z.string(),
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
  contentHash: z.string(),
  reused: z.boolean(),
});

export type AdminOriginAsset = z.infer<typeof adminOriginAssetSchema>;

/** Read-only backend-owned workflow policy shown by admin work projections. */
export const adminWorkflowPolicySchema = z.object({
  autoChainEnabled: z.boolean(),
  ttsStepEnabled: z.boolean(),
});

export type AdminWorkflowPolicy = z.infer<typeof adminWorkflowPolicySchema>;

/** Admin work JSON includes derived projection freshness for ops reminders. */
export const adminWorkSchema = workSchema.extend({
  workflowPolicy: adminWorkflowPolicySchema,
  derivedFreshness: derivedFreshnessSchema,
  originMeta: z.record(z.string(), z.unknown()).default({}),
  originAsset: adminOriginAssetSchema.nullable(),
  parts: z.array(partSchema),
  category: z.string().nullable(),
  /** Step that failed when status is `failed` (from originMeta.failedStep). */
  failedStep: z.enum(WORKFLOW_STEPS).nullable(),
  /** Per-field provenance for admin review UI — runtime projection from junction + description_provenance. */
  metadataProvenance: z.record(z.string(), z.enum(WORK_METADATA_PROVENANCES)).default({}),
});

export type AdminWork = z.infer<typeof adminWorkSchema>;

/**
 * Compact admin list row — no part bodies. `partCount` lets the list show
 * chapter counts without shipping HTML for every part.
 */
export const adminWorkSummarySchema = workSchema.extend({
  workflowPolicy: adminWorkflowPolicySchema,
  derivedFreshness: derivedFreshnessSchema,
  originMeta: z.record(z.string(), z.unknown()).default({}),
  originAsset: adminOriginAssetSchema.nullable(),
  partCount: z.number().int().nonnegative(),
  category: z.string().nullable(),
  failedStep: z.enum(WORKFLOW_STEPS).nullable(),
  /** Per-field provenance for admin review UI — runtime projection from junction + description_provenance. */
  metadataProvenance: z.record(z.string(), z.enum(WORK_METADATA_PROVENANCES)).default({}),
});

export type AdminWorkSummary = z.infer<typeof adminWorkSummarySchema>;

/** Internal admin_text seed — title + body only. */
export const createAdminTextWorkBodySchema = z.object({
  title: z.string().trim().min(1).max(WORK_TITLE_MAX),
  body: z.string().min(1).max(PART_BODY_MAX_CHARS),
});

export type CreateAdminTextWorkBody = z.infer<typeof createAdminTextWorkBodySchema>;

/** Response of `POST /api/admin/works/epub` — upload creates work + origin_file asset. */
export const createEpubWorkResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: workStatusSchema,
  originKind: workOriginKindSchema,
  originMeta: z.record(z.string(), z.unknown()).default({}),
  asset: z.object({
    storageKey: z.string(),
    mimeType: z.string(),
    contentHash: z.string(),
    size: z.number().int().nonnegative(),
  }),
});

export type CreateEpubWorkResult = z.infer<typeof createEpubWorkResultSchema>;

/** Body of `POST /api/admin/works/epub/reuse` — instant-upload dedupe lookup. */
export const checkEpubWorkReuseBodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/, '文件哈希无效'),
});

export type CheckEpubWorkReuseBody = z.infer<typeof checkEpubWorkReuseBodySchema>;

/** Response of the reuse endpoint — either an instant-created work or a miss. */
export const epubReuseResultSchema = z.discriminatedUnion('duplicated', [
  createEpubWorkResultSchema.extend({ duplicated: z.literal(true) }),
  z.object({ duplicated: z.literal(false) }),
]);

export type EpubReuseResult = z.infer<typeof epubReuseResultSchema>;

export const updateWorkBodySchema = z.object({
  title: z.string().trim().min(1).max(WORK_TITLE_MAX).optional(),
  author: z.string().max(WORK_AUTHOR_MAX).optional(),
  description: z.string().max(WORK_DESCRIPTION_MAX).optional(),
  tags: tagsSchema.optional(),
  sources: sourcesSchema.optional(),
  category: z.string().max(WORK_CATEGORY_MAX).optional(),
  suggestedVocabSize: z.number().int().positive().nullable().optional(),
  difficultyScore: z.number().int().min(DIFFICULTY_SCORE_MIN).max(DIFFICULTY_SCORE_MAX).nullable().optional(),
});

export type UpdateWorkBody = z.infer<typeof updateWorkBodySchema>;

export const ADMIN_WORK_SORT_FIELDS = ['updatedAt'] as const;
export type AdminWorkSortField = (typeof ADMIN_WORK_SORT_FIELDS)[number];
export const DEFAULT_ADMIN_WORK_SORT_BY = 'updatedAt' as const satisfies AdminWorkSortField;

/** Comma-separated status filter (e.g. `processing,metadata,tts` for "processing"). */
const workStatusFilterSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .optional()
    .refine(
      (value) => !value || value.split(',').every((item) => (WORK_STATUSES as readonly string[]).includes(item)),
      { message: '无效的状态筛选' },
    ),
);

export const adminWorkListQuerySchema = paginationQuerySchema.extend({
  sortBy: createSortByQuerySchema(ADMIN_WORK_SORT_FIELDS, DEFAULT_ADMIN_WORK_SORT_BY),
  status: workStatusFilterSchema,
});

export type AdminWorkListQuery = z.infer<typeof adminWorkListQuerySchema>;

/** Body of `POST /api/admin/works/:id/workflow/retry` — resume the failed step or re-run one step. */
export const retryWorkflowBodySchema = z.object({
  step: z.enum(WORKFLOW_STEPS).optional(),
});

export type RetryWorkflowBody = z.infer<typeof retryWorkflowBodySchema>;

export const adminWorkListDataSchema = z.object({
  items: z.array(adminWorkSummarySchema),
  pagination: paginationMetaSchema,
});

export type AdminWorkListData = z.infer<typeof adminWorkListDataSchema>;

export const CATALOG_SORT_FIELDS = ['publishedAt', 'updatedAt', 'createdAt'] as const;
export type CatalogSortField = (typeof CATALOG_SORT_FIELDS)[number];
export const DEFAULT_CATALOG_SORT_BY = 'publishedAt' as const satisfies CatalogSortField;

const catalogTagQuerySchema = z.preprocess(emptyToUndefined, z.string().trim().min(1).max(WORK_TAG_MAX_LEN).optional());

const catalogSearchQuerySchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).max(WORK_TITLE_MAX).optional(),
);

/** Query for `GET /api/catalog/works`. */
export const catalogListQuerySchema = paginationQuerySchema.extend({
  sortBy: createSortByQuerySchema(CATALOG_SORT_FIELDS, DEFAULT_CATALOG_SORT_BY),
  tag: catalogTagQuerySchema,
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
  tags: z.array(z.string()),
});

export type CatalogListData = z.infer<typeof catalogListDataSchema>;

export { buildPaginationMeta };

export type PublishWorkIssue = { path: string; message: string };

export function getPublishWorkIssues(work: {
  title: string;
  sources: string[];
  tags: string[];
  parts: Array<{ body: string }>;
}): PublishWorkIssue[] {
  const issues: PublishWorkIssue[] = [];

  if (!work.title.trim()) {
    issues.push({ path: 'title', message: '发布前请填写标题' });
  }
  if (work.sources.length < 1) {
    issues.push({ path: 'sources', message: '发布前请至少关联一个来源' });
  }
  if (work.tags.length < 1) {
    issues.push({ path: 'tags', message: '发布前请至少添加一个标签' });
  }
  if (work.parts.length < 1 || !work.parts.some((part) => part.body.trim())) {
    issues.push({ path: 'body', message: '发布前请填写正文' });
  }

  return issues;
}
