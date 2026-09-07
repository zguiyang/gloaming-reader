import { z } from 'zod';

import { readerWorkSummarySchema, readingStateSchema } from '../reader/index.ts';

/** Soft ceiling for shelf grid items (excludes `current`). */
export const SHELF_ITEMS_LIMIT = 48 as const;

export const shelfItemSchema = z.object({
  work: readerWorkSummarySchema,
  state: readingStateSchema,
});

export type ShelfItem = z.infer<typeof shelfItemSchema>;

/** My shelf: continue hero + remaining state-backed works. */
export const shelfDataSchema = z.object({
  current: shelfItemSchema.nullable(),
  items: z.array(shelfItemSchema).max(SHELF_ITEMS_LIMIT),
});

export type ShelfData = z.infer<typeof shelfDataSchema>;
