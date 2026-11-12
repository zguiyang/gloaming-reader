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

/**
 * Lightweight DiscoverySource projection for admin management and Discover
 * source picking. No sync-run fields — on-demand adapters do not sync catalogs.
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

/** Admin enable/disable body for a DiscoverySource. */
export const discoverySourceEnabledUpdateSchema = z.object({
  enabled: z.boolean(),
});
export type DiscoverySourceEnabledUpdate = z.infer<typeof discoverySourceEnabledUpdateSchema>;
