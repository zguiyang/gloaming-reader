import { z } from 'zod';

import {
  createSortByQuerySchema,
  emptyToUndefined,
  paginationMetaSchema,
  paginationQuerySchema,
} from '../pagination/index.ts';

/**
 * Discovery defaults to English text for the V1 scope. This is a query default,
 * not a storage rule: remote sources may expose every upstream language.
 */
export const DISCOVERY_DEFAULT_LANGUAGE = 'en' as const;

/** Max characters accepted for the discovery search term. */
export const SOURCE_RECORD_SEARCH_MAX_CHARS = 200 as const;

/** Explicit, small sort set kept for API compatibility; OPDS paging is cursor-like via page. */
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
  summary: z.string().optional(),
  notes: z.array(z.string()).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type SourceRecordSourceMeta = z.infer<typeof sourceRecordSourceMetaSchema>;

/**
 * Shared Discover content-language query value. Absent or blank falls back to
 * the shared Discover language default.
 */
export const discoveryLanguageQuerySchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).max(35).default(DISCOVERY_DEFAULT_LANGUAGE),
);

/**
 * Query for `GET /api/discover/records`.
 * `facetId` is a source-native facet (Gutenberg Category bookshelf id), not a
 * Gloaming public category.
 */
export const sourceRecordListQuerySchema = paginationQuerySchema.extend({
  sortBy: createSortByQuerySchema(SOURCE_RECORD_SORT_FIELDS, DEFAULT_SOURCE_RECORD_SORT_BY),
  q: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(SOURCE_RECORD_SEARCH_MAX_CHARS).optional()),
  language: discoveryLanguageQuerySchema,
  /** Optional Discover source filter (`project_gutenberg`, …). */
  sourceKey: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(64).optional()),
  facetId: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(64).optional()),
});
export type SourceRecordListQuery = z.infer<typeof sourceRecordListQuerySchema>;

/** Query for `GET /api/discover/facets` — the same optional source filter, validated server-side. */
export const discoveryFacetListQuerySchema = z.object({
  sourceKey: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(64).optional()),
});
export type DiscoveryFacetListQuery = z.infer<typeof discoveryFacetListQuerySchema>;

/**
 * List/detail projection for Discover. Identity for remote candidates is
 * `(sourceKey, externalId)`. `sourceRecordId` is set only after a Save upsert.
 */
export const sourceRecordItemSchema = z.object({
  /** Persisted SourceRecord id after Save; null for pure remote candidates. */
  sourceRecordId: z.string().nullable(),
  linkedWorkId: z.string().nullable(),
  sourceId: z.string().nullable(),
  sourceKey: z.string(),
  sourceType: z.string(),
  externalId: z.string(),
  title: z.string(),
  authors: z.array(sourceRecordAuthorSchema),
  languages: z.array(z.string()),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  availability: sourceRecordAvailabilitySchema,
  sourceUpdatedAt: z.union([z.string(), z.date()]).nullable(),
  lastSeenAt: z.union([z.string(), z.date()]).nullable(),
  createdAt: z.union([z.string(), z.date()]).nullable(),
  updatedAt: z.union([z.string(), z.date()]).nullable(),
  isSaveable: z.boolean(),
  detailAvailable: z.boolean().default(false),
});
export type SourceRecordItem = z.infer<typeof sourceRecordItemSchema>;

export const sourceRecordDetailSchema = sourceRecordItemSchema.extend({
  rightsStatement: z.string().nullable(),
  contentCandidates: z.array(sourceRecordContentCandidateSchema),
  sourceMeta: sourceRecordSourceMetaSchema,
});
export type SourceRecordDetail = z.infer<typeof sourceRecordDetailSchema>;

export const sourceRecordListDataSchema = z.object({
  items: z.array(sourceRecordItemSchema),
  hasMore: z.boolean(),
  pagination: paginationMetaSchema,
});
export type SourceRecordListData = z.infer<typeof sourceRecordListDataSchema>;

/** Source-native Discover facet (e.g. Gutenberg Category bookshelf). */
export const discoveryFacetSchema = z.object({
  id: z.string(),
  name: z.string(),
  sourceKey: z.string(),
});
export type DiscoveryFacet = z.infer<typeof discoveryFacetSchema>;

export const discoveryFacetListDataSchema = z.object({
  items: z.array(discoveryFacetSchema),
});
export type DiscoveryFacetListData = z.infer<typeof discoveryFacetListDataSchema>;

/** Body for saving a remote Discover candidate into the Library. */
export const discoverSaveBodySchema = z.object({
  sourceKey: z.string().trim().min(1).max(64),
  externalId: z.string().trim().min(1).max(64),
});
export type DiscoverSaveBody = z.infer<typeof discoverSaveBodySchema>;

/** Source-level sync status for admin surfaces. */
export const DISCOVERY_SOURCE_SYNC_STATUSES = ['idle', 'queued', 'syncing', 'succeeded', 'failed'] as const;
export type DiscoverySourceSyncStatus = (typeof DISCOVERY_SOURCE_SYNC_STATUSES)[number];
export const discoverySourceSyncStatusSchema = z.enum(DISCOVERY_SOURCE_SYNC_STATUSES);

export const DISCOVERY_SYNC_RUN_STAGES = [
  'queued',
  'downloading',
  'processing',
  'succeeded',
  'not_modified',
  'skipped',
  'failed',
] as const;
export type DiscoverySyncRunStage = (typeof DISCOVERY_SYNC_RUN_STAGES)[number];
export const discoverySyncRunStageSchema = z.enum(DISCOVERY_SYNC_RUN_STAGES);

/** Latest bounded history size exposed per source. */
export const DISCOVERY_SYNC_RUN_HISTORY_LIMIT = 30 as const;

/**
 * Lightweight DiscoverySource projection for Discover source picking.
 * Admin status uses {@link discoverySourceStatusSchema}.
 */
export const discoverySourceSummarySchema = z.object({
  sourceKey: z.string(),
  sourceType: z.string(),
  enabled: z.boolean(),
});
export type DiscoverySourceSummary = z.infer<typeof discoverySourceSummarySchema>;

export const discoverySourceListDataSchema = z.object({
  items: z.array(discoverySourceSummarySchema),
});
export type DiscoverySourceListData = z.infer<typeof discoverySourceListDataSchema>;

/** One durable sync-run observation for admins. */
export const discoverySyncRunSummarySchema = z.object({
  id: z.string(),
  stage: discoverySyncRunStageSchema,
  queuedAt: z.union([z.string(), z.date()]),
  finishedAt: z.union([z.string(), z.date()]).nullable(),
  inserted: z.number().int().nonnegative(),
  refreshed: z.number().int().nonnegative(),
  evicted: z.number().int().nonnegative(),
  skippedFilter: z.number().int().nonnegative(),
  errorSummary: z.string().nullable(),
});
export type DiscoverySyncRunSummary = z.infer<typeof discoverySyncRunSummarySchema>;

export const discoverySyncRunHistorySchema = z.object({
  runs: z.array(discoverySyncRunSummarySchema),
});
export type DiscoverySyncRunHistory = z.infer<typeof discoverySyncRunHistorySchema>;

/**
 * Admin-facing status for a single DiscoverySource (bounded catalog index).
 */
export const discoverySourceStatusSchema = z.object({
  sourceKey: z.string(),
  sourceType: z.string(),
  enabled: z.boolean(),
  maxRows: z.number().int().positive(),
  syncStatus: discoverySourceSyncStatusSchema,
  recordCount: z.number().int().nonnegative(),
  lastSuccessAt: z.union([z.string(), z.date()]).nullable(),
  lastErrorSummary: z.string().nullable(),
  /** Approximate index size in MiB (soft reporting). */
  estimatedIndexMiB: z.number().nonnegative(),
  /** Soft budget in MiB. */
  budgetMiB: z.number().nonnegative(),
});
export type DiscoverySourceStatus = z.infer<typeof discoverySourceStatusSchema>;

export const discoverySourceStatusListDataSchema = z.object({
  items: z.array(discoverySourceStatusSchema),
});
export type DiscoverySourceStatusListData = z.infer<typeof discoverySourceStatusListDataSchema>;

/** Admin enable/disable body for a DiscoverySource. */
export const discoverySourceEnabledUpdateSchema = z.object({
  enabled: z.boolean(),
});
export type DiscoverySourceEnabledUpdate = z.infer<typeof discoverySourceEnabledUpdateSchema>;

/** Admin settings patch for a DiscoverySource (MVP: enabled + maxRows). */
export const discoverySourceSettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  maxRows: z.number().int().min(100).max(100_000).optional(),
});
export type DiscoverySourceSettingsUpdate = z.infer<typeof discoverySourceSettingsUpdateSchema>;

/**
 * Manual sync trigger outcome. `already_running` means a queued/syncing run is
 * still pending; `disabled` means the source is off and no new run was claimed.
 */
export const DISCOVERY_SYNC_TRIGGER_RESULTS = ['queued', 'already_running', 'disabled'] as const;
export type DiscoverySyncTriggerResult = (typeof DISCOVERY_SYNC_TRIGGER_RESULTS)[number];
export const discoverySyncTriggerResultSchema = z.object({
  result: z.enum(DISCOVERY_SYNC_TRIGGER_RESULTS),
});
export type DiscoverySyncTriggerResultData = z.infer<typeof discoverySyncTriggerResultSchema>;
