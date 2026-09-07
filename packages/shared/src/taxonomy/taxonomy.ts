import { z } from 'zod';

import { WORK_METADATA_PROVENANCES, type WorkMetadataProvenance } from '../works/index.ts';

/** Shared dimension kinds — system-level concepts usable beyond works. */
export const TAXONOMY_KINDS = ['tag', 'category', 'source'] as const;
export type TaxonomyKind = (typeof TAXONOMY_KINDS)[number];

/** Kinds eligible for the unused-cleanup action (sources are never deleted). */
export const TAXONOMY_CLEANABLE_KINDS = ['tag', 'category'] as const;
export type TaxonomyCleanableKind = (typeof TAXONOMY_CLEANABLE_KINDS)[number];

export const TAXONOMY_NAME_MAX = 100 as const;
export const TAXONOMY_MATCH_RULE_MAX = 200 as const;

export const TAXONOMY_ORIGINS = WORK_METADATA_PROVENANCES;
export type TaxonomyOrigin = WorkMetadataProvenance;

/** One dimension row — `usage` = number of works linked to it. */
export const taxonomyItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  usage: z.number().int().nonnegative(),
  /** Who first created this row: extracted (parse) / ai / manual. */
  origin: z.enum(TAXONOMY_ORIGINS),
  /** Only sources carry a match rule; tags/categories return null. */
  matchRule: z.string().nullable(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export type TaxonomyItem = z.infer<typeof taxonomyItemSchema>;

export const createTaxonomyBodySchema = z.object({
  name: z.string().trim().min(1).max(TAXONOMY_NAME_MAX),
  matchRule: z.string().trim().max(TAXONOMY_MATCH_RULE_MAX).optional(),
});

export type CreateTaxonomyBody = z.infer<typeof createTaxonomyBodySchema>;

export const updateTaxonomyBodySchema = z.object({
  name: z.string().trim().min(1).max(TAXONOMY_NAME_MAX).optional(),
  matchRule: z.string().trim().max(TAXONOMY_MATCH_RULE_MAX).optional(),
});

export type UpdateTaxonomyBody = z.infer<typeof updateTaxonomyBodySchema>;

export const taxonomyListQuerySchema = z.object({
  search: z.string().trim().max(TAXONOMY_NAME_MAX).optional(),
});

export type TaxonomyListQuery = z.infer<typeof taxonomyListQuerySchema>;

export const taxonomyListDataSchema = z.object({
  items: z.array(taxonomyItemSchema),
});

export type TaxonomyListData = z.infer<typeof taxonomyListDataSchema>;

export const taxonomyCleanupResultSchema = z.object({
  deleted: z.number().int().nonnegative(),
});

export type TaxonomyCleanupResult = z.infer<typeof taxonomyCleanupResultSchema>;
