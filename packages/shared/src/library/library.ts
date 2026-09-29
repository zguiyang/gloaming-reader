import { z } from 'zod';

import { readerWorkSummarySchema, readingStateSchema } from '../reader/index.ts';

/** Soft ceiling for Library grid items; Continue Reading is independent. */
export const LIBRARY_ITEMS_LIMIT = 48 as const;

/** A Library member may have no reading progress yet. */
export const libraryAvailabilitySchema = z.enum(['processing', 'ready', 'failed']);

export const libraryItemSchema = z.object({
  work: readerWorkSummarySchema,
  state: readingStateSchema.nullable(),
  /** User-facing readiness bucket derived from the Work pipeline state. */
  availability: libraryAvailabilitySchema,
  /** True only for explicitly saved Catalog works; owned books are not removable from Library. */
  canRemoveFromLibrary: z.boolean(),
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
