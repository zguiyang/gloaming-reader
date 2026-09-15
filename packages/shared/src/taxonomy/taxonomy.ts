import { z } from 'zod';

/** Supported UI/content locales for taxonomy labels. */
export const LANGUAGE_CODES = ['zh-CN', 'en-US'] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];
export const languageCodeSchema = z.enum(LANGUAGE_CODES);

/** Shared dimension kinds — system-level concepts usable beyond works. */
export const TAXONOMY_KINDS = ['tag', 'category', 'source'] as const;
export type TaxonomyKind = (typeof TAXONOMY_KINDS)[number];

/** Kinds eligible for the unused-cleanup action (sources are never deleted). */
export const TAXONOMY_CLEANABLE_KINDS = ['tag', 'category'] as const;
export type TaxonomyCleanableKind = (typeof TAXONOMY_CLEANABLE_KINDS)[number];

export const TAXONOMY_NAME_MAX = 100 as const;
export const TAXONOMY_MATCH_RULE_MAX = 200 as const;

export const TAXONOMY_ORIGINS = ['extracted', 'ai', 'manual'] as const;
export type TaxonomyOrigin = (typeof TAXONOMY_ORIGINS)[number];

const localizedNameValueSchema = z.string().trim().min(1).max(TAXONOMY_NAME_MAX);

/** Locale-keyed display labels — at least one supported locale must be present. */
export const localizedTextSchema = z
  .object({
    'zh-CN': localizedNameValueSchema.optional(),
    'en-US': localizedNameValueSchema.optional(),
  })
  .refine((text) => LANGUAGE_CODES.some((code) => Boolean(text[code]?.trim())), {
    message: 'At least one localized name is required',
  });

export type LocalizedText = z.infer<typeof localizedTextSchema>;
export type LocalizedTextMap = Partial<Record<LanguageCode, string>>;

/** Resolve the display label for a taxonomy row in the requested locale. */
export function resolveLocalizedText(names: LocalizedTextMap | null | undefined, locale: LanguageCode): string {
  const localized = names?.[locale]?.trim();
  if (localized && localized.length > 0) {
    return localized;
  }

  for (const code of LANGUAGE_CODES) {
    if (code === locale) continue;
    const fallback = names?.[code]?.trim();
    if (fallback && fallback.length > 0) {
      return fallback;
    }
  }

  return '';
}

/** Merge a locale-specific label into an existing localized text map. */
export function mergeLocalizedText(
  existing: LocalizedTextMap | null | undefined,
  locale: LanguageCode,
  name: string,
): LocalizedTextMap {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return existing ?? {};
  }
  return { ...(existing ?? {}), [locale]: trimmed };
}

/** Include names in API payloads only when non-empty. */
export function optionalLocalizedText(names: LocalizedTextMap | null | undefined): LocalizedTextMap | undefined {
  const map = names ?? {};
  return Object.keys(map).length > 0 ? map : undefined;
}

/** Stable taxonomy reference embedded on works and returned by admin APIs. */
export const taxonomyReferenceSchema = z.object({
  id: z.string(),
  names: localizedTextSchema,
  origin: z.enum(TAXONOMY_ORIGINS),
});

export type TaxonomyReference = z.infer<typeof taxonomyReferenceSchema>;

/** Source/channel reference — source names are stored and displayed verbatim. */
export const sourceReferenceSchema = z.object({
  id: z.string(),
  name: localizedNameValueSchema,
  origin: z.enum(TAXONOMY_ORIGINS),
  matchRule: z.string().nullable().optional(),
});

export type SourceReference = z.infer<typeof sourceReferenceSchema>;

/** Stable taxonomy id submitted on work mutations — display fields are server-owned. */
export const taxonomySelectionSchema = z
  .object({
    id: z.string(),
  })
  .strict();

export type TaxonomySelection = z.infer<typeof taxonomySelectionSchema>;

/** One dimension row — `usage` = number of works linked to it. */
export const taxonomyItemSchema = taxonomyReferenceSchema.extend({
  usage: z.number().int().nonnegative(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export type TaxonomyItem = z.infer<typeof taxonomyItemSchema>;

/** One source/channel row returned by the admin dimension API. */
export const sourceItemSchema = sourceReferenceSchema.extend({
  usage: z.number().int().nonnegative(),
  matchRule: z.string().nullable(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export type SourceItem = z.infer<typeof sourceItemSchema>;

export const taxonomyItemResultSchema = z.union([taxonomyItemSchema, sourceItemSchema]);
export type TaxonomyItemResult = z.infer<typeof taxonomyItemResultSchema>;

const createLocalizedTaxonomyBodySchema = z.object({
  names: localizedTextSchema,
  matchRule: z.string().trim().max(TAXONOMY_MATCH_RULE_MAX).optional(),
});

const createSourceBodySchema = z.object({
  name: localizedNameValueSchema,
  matchRule: z.string().trim().max(TAXONOMY_MATCH_RULE_MAX).optional(),
});

export const createTaxonomyBodySchema = z.union([createLocalizedTaxonomyBodySchema, createSourceBodySchema]);

export type CreateTaxonomyBody = z.infer<typeof createTaxonomyBodySchema>;

const updateLocalizedTaxonomyBodySchema = z.object({
  names: localizedTextSchema.optional(),
  matchRule: z.string().trim().max(TAXONOMY_MATCH_RULE_MAX).optional(),
});

const updateSourceBodySchema = z.object({
  name: localizedNameValueSchema.optional(),
  matchRule: z.string().trim().max(TAXONOMY_MATCH_RULE_MAX).optional(),
});

export const updateTaxonomyBodySchema = z.union([updateLocalizedTaxonomyBodySchema, updateSourceBodySchema]);

export type UpdateTaxonomyBody = z.infer<typeof updateTaxonomyBodySchema>;

export const taxonomyListQuerySchema = z.object({
  search: z.string().trim().max(TAXONOMY_NAME_MAX).optional(),
});

export type TaxonomyListQuery = z.infer<typeof taxonomyListQuerySchema>;

export const taxonomyListDataSchema = z.object({
  items: z.array(taxonomyItemResultSchema),
});

export type TaxonomyListData = z.infer<typeof taxonomyListDataSchema>;

/** Public catalog facet — stable id and localized names only (no admin metadata). */
export const catalogTaxonomyFacetSchema = z
  .object({
    id: z.string(),
    names: localizedTextSchema,
  })
  .strict();

export type CatalogTaxonomyFacet = z.infer<typeof catalogTaxonomyFacetSchema>;

export const catalogTaxonomyListDataSchema = z.object({
  items: z.array(catalogTaxonomyFacetSchema),
});

export type CatalogTaxonomyListData = z.infer<typeof catalogTaxonomyListDataSchema>;

export const taxonomyCleanupResultSchema = z.object({
  deleted: z.number().int().nonnegative(),
});

export type TaxonomyCleanupResult = z.infer<typeof taxonomyCleanupResultSchema>;
