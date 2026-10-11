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

/**
 * Locale-independent comparison key for a public category label. Mirrors the
 * NFC / whitespace-folded / case-folded key persisted as
 * `public_category_label.normalized_name`. It only narrows candidates for
 * duplicate detection; semantic identity is still a classification decision and
 * never string equality.
 */
export function normalizePublicCategoryName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');
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
 * A flat, stable Discover category. Identity is `id`; `localizedNames` carries
 * display names per locale so renaming never changes identity. There is no
 * parent/hierarchy and no User Tag sharing.
 */
export const publicCategorySchema = z.object({
  id: z.string(),
  createdBy: publicCategoryProvenanceSchema,
  /** Locale of the canonical label when the creator recorded one. */
  sourceLocale: z.string().nullable().default(null),
  /** Locales whose label was manually edited; automation must never overwrite them. */
  manualLocales: z.array(z.string()).default([]),
  /** Localized display names keyed by locale; missing keys are untranslated. */
  localizedNames: z.record(z.string(), z.string()).default({}),
});
export type PublicCategory = z.infer<typeof publicCategorySchema>;

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
 * List row for the discovery read model.
 * The stable Discover identity is `sourceRecordId`; it is never a ReadingWork id.
 */
export const sourceRecordItemSchema = z.object({
  sourceRecordId: z.string(),
  sourceId: z.string(),
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
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
  /** Public categories projected for Discover; absent until the read model adds them. */
  categories: z.array(publicCategorySchema).optional(),
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
