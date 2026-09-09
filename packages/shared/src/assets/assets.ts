import { z } from 'zod';

import {
  buildPaginationMeta,
  createSortByQuerySchema,
  emptyToUndefined,
  paginationMetaSchema,
  paginationQuerySchema,
} from '../pagination/index.ts';

/** Storage health categories derived from ContentAsset kind and/or object key prefix. */
export const ASSET_CATEGORIES = ['audio', 'cover', 'image', 'origin', 'other'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/** Reconciliation status of a storage object relative to database references. */
export const ASSET_OBJECT_STATUSES = ['referenced', 'orphan', 'missing'] as const;
export type AssetObjectStatus = (typeof ASSET_OBJECT_STATUSES)[number];

export const ASSET_OBJECT_SORT_FIELDS = ['size', 'lastModified', 'key'] as const;
export type AssetObjectSortField = (typeof ASSET_OBJECT_SORT_FIELDS)[number];
export const DEFAULT_ASSET_OBJECT_SORT_BY = 'size' as const satisfies AssetObjectSortField;

export const ASSET_OBJECT_DEFAULT_PAGE_SIZE = 20 as const;
export const ASSET_LARGEST_OBJECTS_DEFAULT = 10 as const;
export const ASSET_LARGEST_OBJECTS_MAX = 20 as const;

/** Filter query values that include an "all" sentinel for UI tabs. */
export const ASSET_STATUS_FILTERS = ['all', ...ASSET_OBJECT_STATUSES] as const;
export type AssetStatusFilter = (typeof ASSET_STATUS_FILTERS)[number];

export const ASSET_CATEGORY_FILTERS = ['all', ...ASSET_CATEGORIES] as const;
export type AssetCategoryFilter = (typeof ASSET_CATEGORY_FILTERS)[number];

const assetCategorySchema = z.enum(ASSET_CATEGORIES);
const assetObjectStatusSchema = z.enum(ASSET_OBJECT_STATUSES);

export const assetObjectItemSchema = z.object({
  key: z.string().min(1),
  category: assetCategorySchema,
  status: assetObjectStatusSchema,
  size: z.number().int().nonnegative(),
  lastModified: z.union([z.string(), z.date(), z.null()]),
  etag: z.string().nullable(),
});

export type AssetObjectItem = z.infer<typeof assetObjectItemSchema>;

export const assetCategorySummarySchema = z.object({
  category: assetCategorySchema,
  objectCount: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
});

export type AssetCategorySummary = z.infer<typeof assetCategorySummarySchema>;

export const assetScanReportSchema = z.object({
  scanId: z.string().min(1),
  measuredAt: z.union([z.string(), z.date()]),
  scanComplete: z.boolean(),
  objectCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  referencedObjectCount: z.number().int().nonnegative(),
  referencedBytes: z.number().int().nonnegative(),
  orphanCount: z.number().int().nonnegative(),
  orphanBytes: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(),
  categories: z.array(assetCategorySummarySchema),
  largestObjects: z.array(assetObjectItemSchema).max(ASSET_LARGEST_OBJECTS_MAX),
});

export type AssetScanReport = z.infer<typeof assetScanReportSchema>;

export const assetObjectListQuerySchema = paginationQuerySchema.extend({
  pageSize: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(100).default(ASSET_OBJECT_DEFAULT_PAGE_SIZE),
  ),
  sortBy: createSortByQuerySchema(ASSET_OBJECT_SORT_FIELDS, DEFAULT_ASSET_OBJECT_SORT_BY),
  status: z.preprocess(emptyToUndefined, z.enum(ASSET_STATUS_FILTERS).default('all')),
  category: z.preprocess(emptyToUndefined, z.enum(ASSET_CATEGORY_FILTERS).default('all')),
});

export type AssetObjectListQuery = z.infer<typeof assetObjectListQuerySchema>;

export const assetObjectListDataSchema = z.object({
  items: z.array(assetObjectItemSchema),
  pagination: paginationMetaSchema,
});

export type AssetObjectListData = z.infer<typeof assetObjectListDataSchema>;

export const assetCleanupRequestSchema = z.object({
  confirmed: z.literal(true),
});

export type AssetCleanupRequest = z.infer<typeof assetCleanupRequestSchema>;

export const assetCleanupFailureSchema = z.object({
  key: z.string().min(1),
  error: z.string().min(1),
});

export type AssetCleanupFailure = z.infer<typeof assetCleanupFailureSchema>;

export const assetCleanupResultSchema = z.object({
  scanId: z.string().min(1),
  requestedCount: z.number().int().nonnegative(),
  deletedCount: z.number().int().nonnegative(),
  skippedReferencedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  deletedBytes: z.number().int().nonnegative(),
  failed: z.array(assetCleanupFailureSchema),
});

export type AssetCleanupResult = z.infer<typeof assetCleanupResultSchema>;

/**
 * Classify an object by ContentAsset kind (when known) or key prefix.
 * Kind wins when it maps to a known category.
 */
export function classifyAssetKey(key: string, kind?: string | null): AssetCategory {
  if (kind) {
    if (kind.startsWith('audio_')) return 'audio';
    if (kind === 'cover') return 'cover';
    if (kind === 'image') return 'image';
    if (kind === 'origin_file') return 'origin';
  }
  if (key.startsWith('part-audio/')) return 'audio';
  if (key.startsWith('covers/')) return 'cover';
  if (key.startsWith('book-images/')) return 'image';
  if (key.startsWith('epub/')) return 'origin';
  return 'other';
}

export { buildPaginationMeta };
