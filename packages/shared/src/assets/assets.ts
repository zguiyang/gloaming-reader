import { z } from 'zod';

/** Storage health categories derived from ContentAsset kind and/or object key prefix. */
export const ASSET_CATEGORIES = ['audio', 'cover', 'image', 'origin', 'other'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/** `part-audio/{partId}/{kind}/{contentHash}/seg/{file}.mp3` */
const LEGACY_AUDIO_SEGMENT_KEY_RE = /^part-audio\/([^/]+)\/([^/]+)\/([^/]+)\/seg\/([^/]+\.mp3)$/i;

export type LegacyAudioSegmentKeyParts = {
  partId: string;
  kind: string;
  contentHash: string;
  segmentFile: string;
};

/** True for historical TTS segment object keys (never for chapter.mp3). */
export function isLegacyAudioSegmentKey(key: string): boolean {
  return LEGACY_AUDIO_SEGMENT_KEY_RE.test(key);
}

/** Parse a segment key into part/kind/hash components; null when not a segment path. */
export function parseLegacyAudioSegmentKey(key: string): LegacyAudioSegmentKeyParts | null {
  const match = key.match(LEGACY_AUDIO_SEGMENT_KEY_RE);
  if (!match) return null;
  return {
    partId: match[1]!,
    kind: match[2]!,
    contentHash: match[3]!,
    segmentFile: match[4]!,
  };
}

/** Sibling formal chapter key for the same part/kind/hash prefix. */
export function siblingChapterKeyForSegment(key: string): string | null {
  const parts = parseLegacyAudioSegmentKey(key);
  if (!parts) return null;
  return `part-audio/${parts.partId}/${parts.kind}/${parts.contentHash}/chapter.mp3`;
}

/** Hard cap for a single health scan. Incomplete scans must not be cleaned up. */
export const ASSET_SCAN_OBJECT_LIMIT = 20_000 as const;

export const ASSET_CLEANUP_JOB_STATUSES = ['queued', 'running', 'completed', 'partial', 'failed'] as const;
export type AssetCleanupJobStatus = (typeof ASSET_CLEANUP_JOB_STATUSES)[number];

const assetCategorySchema = z.enum(ASSET_CATEGORIES);

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
  legacyDuplicateCount: z.number().int().nonnegative(),
  legacyDuplicateBytes: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  categories: z.array(assetCategorySummarySchema),
});

export type AssetScanReport = z.infer<typeof assetScanReportSchema>;

export const assetCleanupRequestSchema = z.object({
  confirmed: z.literal(true),
});

export type AssetCleanupRequest = z.infer<typeof assetCleanupRequestSchema>;

export const assetCleanupRetryRequestSchema = assetCleanupRequestSchema;
export type AssetCleanupRetryRequest = AssetCleanupRequest;

const assetCleanupJobStatusSchema = z.enum(ASSET_CLEANUP_JOB_STATUSES);

/** 202 Accepted payload after enqueueing an orphan-cleanup job. */
export const assetCleanupJobAcceptedSchema = z.object({
  jobId: z.string().min(1),
  scanId: z.string().min(1),
  status: assetCleanupJobStatusSchema,
});

export type AssetCleanupJobAccepted = z.infer<typeof assetCleanupJobAcceptedSchema>;

export const assetCleanupJobVerificationSchema = z.object({
  ran: z.boolean(),
  orphanCount: z.number().int().nonnegative().optional(),
  missingCount: z.number().int().nonnegative().optional(),
  scanComplete: z.boolean().optional(),
  scanId: z.string().min(1).optional(),
});

export type AssetCleanupJobVerification = z.infer<typeof assetCleanupJobVerificationSchema>;

/** Redis-backed cleanup job projection with aggregate progress, never object identities. */
export const assetCleanupJobSchema = z.object({
  jobId: z.string().min(1),
  scanId: z.string().min(1),
  status: assetCleanupJobStatusSchema,
  requestedCount: z.number().int().nonnegative(),
  processedCount: z.number().int().nonnegative(),
  deletedCount: z.number().int().nonnegative(),
  skippedReferencedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  deletedBytes: z.number().int().nonnegative(),
  verification: assetCleanupJobVerificationSchema.optional(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export type AssetCleanupJob = z.infer<typeof assetCleanupJobSchema>;

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
