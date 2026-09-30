import { z } from 'zod';

import { readerWorkSummarySchema, readingStateSchema } from '../reader/index.ts';

/** Soft ceiling for Library grid items; Continue Reading is independent. */
export const LIBRARY_ITEMS_LIMIT = 48 as const;

/** A Library member may have no reading progress yet. */
export const libraryAvailabilitySchema = z.enum(['processing', 'ready', 'failed']);

/** Private Library organization label, separate from Catalog taxonomy. */
export const userTagSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const userTagManagementItemSchema = userTagSchema.extend({
  bookCount: z.number().int().nonnegative(),
});

export const userTagListSchema = z.array(userTagManagementItemSchema);

export const userTagWriteSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export type UserTag = z.infer<typeof userTagSchema>;
export type UserTagManagementItem = z.infer<typeof userTagManagementItemSchema>;

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
});

export type LibraryData = z.infer<typeof libraryDataSchema>;
