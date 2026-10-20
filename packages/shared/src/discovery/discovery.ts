import { z } from 'zod';

import {
  createSortByQuerySchema,
  emptyToUndefined,
  paginationMetaSchema,
  paginationQuerySchema,
} from '../pagination/index.ts';

/**
 * Discovery defaults to English text for the V1 scope. This is a query default,
 * not a storage rule: `source_record.languages` keeps every upstream language.
 */
export const DISCOVERY_DEFAULT_LANGUAGE = 'en' as const;

/** Max characters accepted for the discovery search term. */
export const SOURCE_RECORD_SEARCH_MAX_CHARS = 200 as const;

/** Explicit, small sort set for the local SourceRecord read model. */
export const SOURCE_RECORD_SORT_FIELDS = ['title', 'sourceUpdatedAt', 'updatedAt'] as const;
export type SourceRecordSortField = (typeof SOURCE_RECORD_SORT_FIELDS)[number];
export const DEFAULT_SOURCE_RECORD_SORT_BY = 'sourceUpdatedAt' as const satisfies SourceRecordSortField;

export const SOURCE_RECORD_AVAILABILITIES = ['available', 'unavailable'] as const;
export type SourceRecordAvailability = (typeof SOURCE_RECORD_AVAILABILITIES)[number];
export const sourceRecordAvailabilitySchema = z.enum(SOURCE_RECORD_AVAILABILITIES);

export const sourceRecordAuthorSchema = z.object({
  name: z.string(),
  sortName: z.string().optional(),
  role: z.string().optional(),
});
export type SourceRecordAuthor = z.infer<typeof sourceRecordAuthorSchema>;

export const sourceRecordContentCandidateSchema = z.object({
  format: z.string(),
  url: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  updatedAt: z.string().optional(),
});
export type SourceRecordContentCandidate = z.infer<typeof sourceRecordContentCandidateSchema>;

export const sourceRecordSourceMetaSchema = z.object({
  subjects: z.array(z.string()).optional(),
  bookshelves: z.array(z.string()).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type SourceRecordSourceMeta = z.infer<typeof sourceRecordSourceMetaSchema>;

/** Provenance shared by a public category, its labels, and its source assignments. */
export const PUBLIC_CATEGORY_PROVENANCES = ['manual', 'ai'] as const;
export type PublicCategoryProvenance = (typeof PUBLIC_CATEGORY_PROVENANCES)[number];
export const publicCategoryProvenanceSchema = z.enum(PUBLIC_CATEGORY_PROVENANCES);

/** Max characters accepted for one public category display label. */
export const PUBLIC_CATEGORY_NAME_MAX_CHARS = 80 as const;

/**
 * Product cap: one SourceRecord carries at most this many public categories.
 * Enforced by the owning Discovery category service, not by the database.
 */
export const PUBLIC_CATEGORY_ASSIGNMENT_LIMIT = 3 as const;

const unsafePublicCategoryNameCharacters = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;

/**
 * A public category display label, shared by manual creation and localized label
 * edits. Control and bidi-override characters are rejected exactly like personal
 * tag labels so a label cannot spoof surrounding UI text.
 */
export const publicCategoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PUBLIC_CATEGORY_NAME_MAX_CHARS)
  .refine((value) => !unsafePublicCategoryNameCharacters.test(value))
  .transform(canonicalizePublicCategoryName);

/** Admin write body for creating a category or editing one localized label. */
export const publicCategoryWriteSchema = z.object({
  name: publicCategoryNameSchema,
  locale: z.string().trim().min(1).max(35).optional(),
});
export type PublicCategoryWrite = z.infer<typeof publicCategoryWriteSchema>;

/**
 * Canonical display form of a public category label: Unicode NFC, trimmed, and
 * with internal whitespace runs collapsed to a single space. Casing is preserved
 * because it is presentation, not identity.
 */
export function canonicalizePublicCategoryName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

/**
 * Locale-independent comparison key for a public category label. Mirrors the
 * NFC / whitespace-folded / case-folded key persisted as
 * `public_category_label.normalized_name`. It only narrows candidates for
 * duplicate detection; semantic identity is still a classification decision and
 * never string equality.
 */
export function normalizePublicCategoryName(value: string): string {
  return canonicalizePublicCategoryName(value).toLocaleLowerCase('und');
}

/** One localized display name for a public category. */
export const publicCategoryLabelSchema = z.object({
  locale: z.string(),
  name: z.string(),
  /** `manual` labels are protected from automatic overwrite. */
  editedBy: publicCategoryProvenanceSchema,
});
export type PublicCategoryLabel = z.infer<typeof publicCategoryLabelSchema>;

/**
 * One known localized synonym used for candidate retrieval. Aliases are separate
 * from the display label; a source term like `Sci-Fi` can resolve to the
 * `Science Fiction` category without renaming it. `manual` aliases are protected
 * from automatic overwrite.
 */
export const publicCategoryAliasSchema = z.object({
  locale: z.string(),
  alias: z.string(),
  editedBy: publicCategoryProvenanceSchema,
});
export type PublicCategoryAlias = z.infer<typeof publicCategoryAliasSchema>;

/**
 * A flat, stable Discover category. Identity is `id`; `localizedNames` carries
 * display names per locale so renaming never changes identity. There is no
 * parent/hierarchy and no User Tag sharing.
 */
export const publicCategorySchema = z.object({
  id: z.string(),
  createdBy: publicCategoryProvenanceSchema,
  /** Locale of the canonical label when the creator recorded one. */
  sourceLocale: z.string().nullable().default(null),
  /** Concise internal scope/meaning used for candidate retrieval. */
  meaning: z.string().nullable().default(null),
  /** Locales whose label was manually edited; automation must never overwrite them. */
  manualLocales: z.array(z.string()).default([]),
  /** Localized display names keyed by locale; missing keys are untranslated. */
  localizedNames: z.record(z.string(), z.string()).default({}),
  /** Known localized synonyms used to find this category; not part of the display label. */
  aliases: z.array(publicCategoryAliasSchema).default([]),
});
export type PublicCategory = z.infer<typeof publicCategorySchema>;

/**
 * Minimal Discover display projection of a public category: the stable `id` plus
 * a display `name` already resolved for the request locale. This is the only
 * category shape a public SourceRecord response may expose; the retrieval and
 * management fields (`meaning`, `aliases`, `manualLocales`, `localizedNames`,
 * `createdBy`, `sourceLocale`) stay on the full `publicCategorySchema`.
 */
export const publicCategorySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type PublicCategorySummary = z.infer<typeof publicCategorySummarySchema>;

/**
 * Minimal public Discover category list/detail item: the stable `id`, the display
 * `name` already resolved for the requested locale, and the count of publicly
 * discoverable SourceRecords in that category. Retrieval/management fields
 * (`meaning`, `aliases`, `manualLocales`, `localizedNames`, `createdBy`,
 * `sourceLocale`) never appear here.
 */
export const publicCategoryListItemSchema = publicCategorySummarySchema.extend({
  recordCount: z.number().int().nonnegative(),
});
export type PublicCategoryListItem = z.infer<typeof publicCategoryListItemSchema>;

/** Public category list payload. Categories are few; this read is not paginated. */
export const publicCategoryListDataSchema = z.object({
  items: z.array(publicCategoryListItemSchema),
});
export type PublicCategoryListData = z.infer<typeof publicCategoryListDataSchema>;

/** Public category detail is the same minimal projection as a list item. */
export const publicCategoryDetailSchema = publicCategoryListItemSchema;
export type PublicCategoryDetail = z.infer<typeof publicCategoryDetailSchema>;

/**
 * Admin management projection: the full category contract (localized labels,
 * aliases, meaning, provenance) plus the total number of assigned SourceRecords.
 * Admin-only; never returned by a public route.
 */
export const publicCategoryManagementItemSchema = publicCategorySchema.extend({
  recordCount: z.number().int().nonnegative(),
  /**
   * Supported locales that still have no label, projected by the admin list so
   * the "complete translations" action can be enabled per category without
   * client-side recomputation. Optional so older payloads degrade gracefully;
   * clients fall back to `localizedNames` when it is absent.
   */
  missingLocales: z.array(z.string()).optional(),
});
export type PublicCategoryManagementItem = z.infer<typeof publicCategoryManagementItemSchema>;

/** One public category assigned to one SourceRecord, with assignment provenance. */
export const sourceRecordPublicCategorySchema = z.object({
  categoryId: z.string(),
  source: publicCategoryProvenanceSchema,
});
export type SourceRecordPublicCategory = z.infer<typeof sourceRecordPublicCategorySchema>;

/**
 * Resolve the display name for a locale using the documented fallback order:
 * requested locale → source/canonical locale → first available label. Returns
 * `null` when the category has no label at all; a fallback never claims to be a
 * translation of the requested locale.
 */
export function resolvePublicCategoryName(category: PublicCategory, locale: string): string | null {
  const names = category.localizedNames ?? {};
  return (
    names[locale] ??
    (category.sourceLocale ? names[category.sourceLocale] : undefined) ??
    Object.values(names)[0] ??
    null
  );
}

/** True when no label exists for the requested locale (display would fall back). */
export function isPublicCategoryTranslationMissing(category: PublicCategory, locale: string): boolean {
  return !category.localizedNames?.[locale];
}

/**
 * Query for `GET /api/discover/records`.
 * `language` defaults to English-first while all upstream languages stay stored.
 */
export const sourceRecordListQuerySchema = paginationQuerySchema.extend({
  sortBy: createSortByQuerySchema(SOURCE_RECORD_SORT_FIELDS, DEFAULT_SOURCE_RECORD_SORT_BY),
  q: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(SOURCE_RECORD_SEARCH_MAX_CHARS).optional()),
  language: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(35).default(DISCOVERY_DEFAULT_LANGUAGE)),
  /** Optional public category filter; the owning read model applies it. */
  categoryId: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
});
export type SourceRecordListQuery = z.infer<typeof sourceRecordListQuerySchema>;

/**
 * Admin query for one category's assigned SourceRecords. It keeps search, sort,
 * and pagination but drops the content-language and category filters: instance
 * management views every assignment regardless of language or public visibility.
 */
export const categorySourceRecordListQuerySchema = sourceRecordListQuerySchema.omit({
  categoryId: true,
  language: true,
});
export type CategorySourceRecordListQuery = z.infer<typeof categorySourceRecordListQuerySchema>;

/**
 * List row for the discovery read model.
 * The stable Discover identity is `sourceRecordId`; it is never a ReadingWork id.
 * `linkedWorkId` is the explicit Reader identity: the readable `reading_work.id`
 * once the SourceRecord has been materialized, or null before that. A linked id
 * alone never implies the viewer may open it — see `detailAvailable`.
 */
export const sourceRecordItemSchema = z.object({
  sourceRecordId: z.string(),
  /** Linked readable `reading_work.id`, or null when not materialized. */
  linkedWorkId: z.string().nullable(),
  sourceId: z.string(),
  sourceKey: z.string(),
  sourceType: z.string(),
  externalId: z.string(),
  title: z.string(),
  authors: z.array(sourceRecordAuthorSchema),
  languages: z.array(z.string()),
  description: z.string().nullable(),
  /**
   * Display cover URL. The source cover URL unless the linked Work carries a
   * local cover asset the current viewer is allowed to read (decided by the
   * backend's central Work Access Policy), in which case it is that asset URL.
   */
  coverUrl: z.string().nullable(),
  availability: sourceRecordAvailabilitySchema,
  sourceUpdatedAt: z.union([z.string(), z.date()]).nullable(),
  lastSeenAt: z.union([z.string(), z.date()]).nullable(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
  /**
   * Whether synced metadata currently contains at least one selectable
   * official EPUB candidate. `false` means the record cannot be saved into the
   * Library right now (for example an audio-only source or a record with no
   * EPUB at all); the record stays visible in Discover either way.
   */
  isSaveable: z.boolean(),
  /**
   * Whether the current viewer can actually open the linked Work's detail page
   * right now: the linked Work is parse-completed and the backend's central
   * Work Access Policy grants this viewer read access (published Catalog Work,
   * the viewer's own personal Work, or the viewer's own Library membership for
   * an unpublished source-linked Work). `false` for unlinked records and for
   * Works still importing, so Discover never exposes a 404 detail entry.
   *
   * Every server projection must set it explicitly (required `boolean` in the
   * output type); `.default(false)` only tolerates payloads from before the
   * field existed so older responses degrade to "no entry" instead of failing
   * schema validation.
   */
  detailAvailable: z.boolean().default(false),
  /**
   * Public category display summaries projected for Discover; absent until the
   * read model adds them. Never embeds the full category-management DTO.
   */
  categories: z.array(publicCategorySummarySchema).optional(),
});
export type SourceRecordItem = z.infer<typeof sourceRecordItemSchema>;

/** Detail adds source-owned fields; it still implies no ReadingWork link. */
export const sourceRecordDetailSchema = sourceRecordItemSchema.extend({
  rightsStatement: z.string().nullable(),
  contentCandidates: z.array(sourceRecordContentCandidateSchema),
  sourceMeta: sourceRecordSourceMetaSchema,
});
export type SourceRecordDetail = z.infer<typeof sourceRecordDetailSchema>;

export const sourceRecordListDataSchema = z.object({
  items: z.array(sourceRecordItemSchema),
  pagination: paginationMetaSchema,
});
export type SourceRecordListData = z.infer<typeof sourceRecordListDataSchema>;

/**
 * Sync lifecycle persisted on `discovery_source.sync_status` (ADR DS-02).
 * Mirrors the database check constraint so admin status and writes share one enum.
 */
export const DISCOVERY_SOURCE_SYNC_STATUSES = ['idle', 'queued', 'syncing', 'succeeded', 'failed'] as const;
export type DiscoverySourceSyncStatus = (typeof DISCOVERY_SOURCE_SYNC_STATUSES)[number];
export const discoverySourceSyncStatusSchema = z.enum(DISCOVERY_SOURCE_SYNC_STATUSES);

/**
 * Observable stage of one sync run. Non-terminal stages are live progress;
 * terminal stages are persisted outcomes. `not_modified` (a successful HTTP
 * 304) is kept distinct from `succeeded` (a completed full scan), and `skipped`
 * covers runs that ended without fetching upstream (disabled or superseded).
 */
export const DISCOVERY_SYNC_RUN_STAGES = [
  'queued',
  'downloading',
  'processing',
  'reconciling',
  'succeeded',
  'not_modified',
  'skipped',
  'failed',
] as const;
export type DiscoverySyncRunStage = (typeof DISCOVERY_SYNC_RUN_STAGES)[number];
export const discoverySyncRunStageSchema = z.enum(DISCOVERY_SYNC_RUN_STAGES);

/** True while a run is still progressing (not terminal). */
export function isDiscoverySyncRunPending(stage: DiscoverySyncRunStage): boolean {
  return stage === 'queued' || stage === 'downloading' || stage === 'processing' || stage === 'reconciling';
}

/**
 * Evidence that a consumer may pick up a waiting queue job. A waiting job alone
 * is not evidence — only real worker registration on the dedicated queue is.
 * `unknown` means the queue could not be consulted (e.g. Redis unavailable);
 * it must never be presented as "no consumer" or as a failed queue.
 */
export const DISCOVERY_SYNC_CONSUMER_STATES = ['available', 'unavailable', 'unknown'] as const;
export type DiscoverySyncConsumerState = (typeof DISCOVERY_SYNC_CONSUMER_STATES)[number];
export const discoverySyncConsumerStateSchema = z.enum(DISCOVERY_SYNC_CONSUMER_STATES);

/** Latest bounded history size persisted/exposed per source; owned by @gloaming/db. */
export const DISCOVERY_SYNC_RUN_HISTORY_LIMIT = 20 as const;

/**
 * One durable sync-run observation for admins. All counts are current-run
 * committed facts: `committedRecords`/`committedBatches` only advance when a
 * batch transaction commits, so a rolled-back batch is never counted. There is
 * deliberately no total, percentage, or inserted/updated split; the source-level
 * total `recordCount` on {@link discoverySourceStatusSchema} stays distinct.
 */
export const discoverySyncRunSummarySchema = z.object({
  id: z.string(),
  stage: discoverySyncRunStageSchema,
  queuedAt: z.union([z.string(), z.date()]),
  startedAt: z.union([z.string(), z.date()]).nullable(),
  lastActivityAt: z.union([z.string(), z.date()]),
  finishedAt: z.union([z.string(), z.date()]).nullable(),
  /** Records committed by this run so far. */
  committedRecords: z.number().int().nonnegative(),
  /** Upsert batches committed by this run so far. */
  committedBatches: z.number().int().nonnegative(),
  /** Records this run reconciled as unavailable (only after a full successful scan). */
  unavailableRecords: z.number().int().nonnegative(),
  /** Sanitized operational error summary for failed runs; null otherwise. */
  errorSummary: z.string().nullable(),
});
export type DiscoverySyncRunSummary = z.infer<typeof discoverySyncRunSummarySchema>;

/**
 * Current-run progress embedded in the admin status response. `run` is null
 * before the first tracked run. `consumer` is only meaningful while the run is
 * `queued`: it reports real consumer evidence, `unavailable`, or `unknown`.
 */
export const discoverySyncRunProgressSchema = z.object({
  run: discoverySyncRunSummarySchema.nullable(),
  consumer: discoverySyncConsumerStateSchema,
});
export type DiscoverySyncRunProgress = z.infer<typeof discoverySyncRunProgressSchema>;

/** Bounded recent-run history (latest first, capped at {@link DISCOVERY_SYNC_RUN_HISTORY_LIMIT}). */
export const discoverySyncRunHistorySchema = z.object({
  runs: z.array(discoverySyncRunSummarySchema),
});
export type DiscoverySyncRunHistory = z.infer<typeof discoverySyncRunHistorySchema>;

/**
 * Admin-facing status for a single DiscoverySource. Source-level only: no
 * SourceRecord list, no ReadingWork linkage, no CMS controls.
 */
export const discoverySourceStatusSchema = z.object({
  sourceKey: z.string(),
  sourceType: z.string(),
  enabled: z.boolean(),
  syncStatus: discoverySourceSyncStatusSchema,
  /** Start of the current/last run; null before the first run. */
  syncStartedAt: z.union([z.string(), z.date()]).nullable(),
  /**
   * End of the last completed run (success or failure). Preserved while a later
   * run is queued or syncing, so it is null only before the first run completes.
   */
  syncFinishedAt: z.union([z.string(), z.date()]).nullable(),
  /** Last fully successful snapshot sync. */
  lastSuccessAt: z.union([z.string(), z.date()]).nullable(),
  /** Total SourceRecord rows owned by the source (available + unavailable). */
  recordCount: z.number().int().nonnegative(),
  /** Sanitized operational error summary; null when the last run succeeded. */
  lastErrorSummary: z.string().nullable(),
  /** Current-run observability: latest tracked run (if any) plus queue-consumer evidence. */
  currentRun: discoverySyncRunProgressSchema,
});
export type DiscoverySourceStatus = z.infer<typeof discoverySourceStatusSchema>;

/** Admin enable/disable body for a DiscoverySource. */
export const discoverySourceEnabledUpdateSchema = z.object({
  enabled: z.boolean(),
});
export type DiscoverySourceEnabledUpdate = z.infer<typeof discoverySourceEnabledUpdateSchema>;

/**
 * Manual sync trigger outcome. `already_running` means a queued/syncing run is
 * still pending; `disabled` means the source `enabled=false` and no new run was
 * claimed. Both are accepted without enqueuing a second job.
 */
export const DISCOVERY_SYNC_TRIGGER_RESULTS = ['queued', 'already_running', 'disabled'] as const;
export type DiscoverySyncTriggerResult = (typeof DISCOVERY_SYNC_TRIGGER_RESULTS)[number];
export const discoverySyncTriggerResultSchema = z.object({
  result: z.enum(DISCOVERY_SYNC_TRIGGER_RESULTS),
});
export type DiscoverySyncAccepted = z.infer<typeof discoverySyncTriggerResultSchema>;
