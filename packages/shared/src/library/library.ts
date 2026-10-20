import { z } from 'zod';

import { readerWorkSummarySchema, readingStateSchema } from '../reader/index.ts';

/** Soft ceiling for Library grid items; Continue Reading is independent. */
export const LIBRARY_ITEMS_LIMIT = 48 as const;

/** A Library member may have no reading progress yet. */
export const libraryAvailabilitySchema = z.enum(['processing', 'ready', 'failed']);

/** Private Library organization label owned by one user. */
export const userTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  localizedNames: z.record(z.string(), z.string()).default({}),
  sourceLocale: z.string().nullable().default(null),
  userEditedLocales: z.array(z.string()).default([]),
  /** Label provenance; `manual` default keeps older payloads and clients compatible. */
  createdBy: z.enum(['ai', 'manual']).default('manual'),
});

export const userTagManagementItemSchema = userTagSchema.extend({
  bookCount: z.number().int().nonnegative(),
});

export const userTagListSchema = z.array(userTagManagementItemSchema);

const unsafeUserTagNameCharacters = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;

export const userTagWriteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => !unsafeUserTagNameCharacters.test(value)),
  locale: z.string().trim().min(1).max(35).optional(),
});

export const userTagTranslationsResultSchema = z.object({
  tag: userTagSchema,
  status: z.enum(['completed', 'incomplete', 'provider_unavailable']),
});

export type UserTag = z.infer<typeof userTagSchema>;
export type UserTagManagementItem = z.infer<typeof userTagManagementItemSchema>;
export type UserTagTranslationsResult = z.infer<typeof userTagTranslationsResultSchema>;

/** Display the requested localization, falling back to the original name without claiming it is translated. */
export function resolveUserTagName(tag: UserTag, locale: string): string {
  return tag.localizedNames?.[locale] ?? tag.name;
}

export function isUserTagTranslationMissing(tag: UserTag, locale: string): boolean {
  return !tag.localizedNames?.[locale];
}

export const libraryItemSchema = z.object({
  work: readerWorkSummarySchema,
  state: readingStateSchema.nullable(),
  /** User-facing readiness bucket derived from the Work pipeline state. */
  availability: libraryAvailabilitySchema,
  /** Stable ownership/membership semantics; does not infer source from origin metadata. */
  libraryItemKind: z.enum(['personal', 'saved_catalog']),
  /** Owner-editable fields that are not part of the public Reader summary. */
  personalMetadata: z.object({ author: z.string() }).nullable(),
  /** True only for explicitly saved Catalog works; owned books are not removable from Library. */
  canRemoveFromLibrary: z.boolean(),
  /** Private organization labels owned by the current user. */
  userTags: z.array(userTagSchema),
});

export type LibraryItem = z.infer<typeof libraryItemSchema>;

/** Continue Reading projects progress and does not declare Library membership. */
export const continueReadingItemSchema = z.object({
  work: readerWorkSummarySchema,
  state: readingStateSchema,
});

export type ContinueReadingItem = z.infer<typeof continueReadingItemSchema>;

export const libraryDataSchema = z.object({
  current: continueReadingItemSchema.nullable(),
  items: z.array(libraryItemSchema).max(LIBRARY_ITEMS_LIMIT),
  /** True only when the owner's Library holds more memberships than `items` returned. */
  isTruncated: z.boolean().default(false),
});

export type LibraryData = z.infer<typeof libraryDataSchema>;

/**
 * Result of an explicit SourceRecord Save Intent (`POST /api/library/source-records/:id`).
 * `pending` means the shared import is queued; `ready` means a readable linked Work
 * already exists and Library membership was completed. No auto-save happens here.
 */
export const SOURCE_RECORD_SAVE_STATUSES = ['pending', 'ready'] as const;
export const sourceRecordSaveResultSchema = z.object({
  status: z.enum(SOURCE_RECORD_SAVE_STATUSES),
  workId: z.string().nullable(),
});

export type SourceRecordSaveResult = z.infer<typeof sourceRecordSaveResultSchema>;

/**
 * Owner-scoped Save Intent status (`GET /api/library/source-records/:id`).
 *
 * `status` is authoritative: linked `workId` alone never means the import is
 * readable — materialization links the Work first and keeps parsing. `none`
 * (no intent), `pending` (queued/processing), `ready` (readable Work and
 * membership completed), `failed` (import failed; retryable). `failureReason`
 * is a cleaned, user-visible reason and is only set for `failed`.
 */
export const SOURCE_RECORD_SAVE_STATUS_VALUES = ['none', 'pending', 'ready', 'failed'] as const;
export const sourceRecordSaveStatusSchema = z.object({
  status: z.enum(SOURCE_RECORD_SAVE_STATUS_VALUES),
  workId: z.string().nullable(),
  failureReason: z.string().nullable(),
});

export type SourceRecordSaveStatus = z.infer<typeof sourceRecordSaveStatusSchema>;
