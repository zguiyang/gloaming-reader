import { z } from 'zod';

import { ttsVoiceRoleValues, ttsWordTimingSchema } from '../tts/index.ts';

export const CONTENT_ASSET_AUDIO_KINDS = ['audio_us', 'audio_uk'] as const;
export type ContentAssetAudioKind = (typeof CONTENT_ASSET_AUDIO_KINDS)[number];

/** Stable identity for one part/audio-role/source-content generation. */
export function buildContentAssetGenerationKey(input: {
  partId: string;
  kind: ContentAssetAudioKind;
  contentHash: string;
}): string {
  return `${input.partId}:${input.kind}:${input.contentHash}`;
}

/** Backend handoff facts for one DB-backed generation claim; not a learner response. */
export const contentAssetGenerationClaimSchema = z.object({
  generationKey: z.string().min(1),
  generationToken: z.string().min(1),
  generationClaimedAt: z.union([z.string(), z.date()]),
  generationLeaseExpiresAt: z.union([z.string(), z.date()]),
});

export type ContentAssetGenerationClaim = z.infer<typeof contentAssetGenerationClaimSchema>;

/** Map TTS voice role to content_asset.kind. */
export function audioKindForRole(role: (typeof ttsVoiceRoleValues)[number]): ContentAssetAudioKind {
  return role === 'us' ? 'audio_us' : 'audio_uk';
}

export function roleForAudioKind(kind: ContentAssetAudioKind): (typeof ttsVoiceRoleValues)[number] {
  return kind === 'audio_us' ? 'us' : 'uk';
}

export const CONTENT_ASSET_STATUSES = ['generating', 'ready', 'failed'] as const;
export type ContentAssetStatus = (typeof CONTENT_ASSET_STATUSES)[number];

/** Collapse whitespace the same way Azure synth text is built (SSOT for offsets). */
export function normalizePartAudioWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Exact string passed to TTS for a part. `textOffset` in wordTimings indexes this string.
 * Body-only SSOT — chapter `title` is navigation metadata and must not be prepended
 * (keeps audio aligned with the reading HTML surface).
 */
export function buildPartAudioText(bodyPlain: string): string {
  return normalizePartAudioWhitespace(bodyPlain);
}

export const generatePartAudioBodySchema = z.object({
  roles: z.array(z.enum(ttsVoiceRoleValues)).min(1).max(2).optional(),
  force: z.boolean().optional(),
});

export type GeneratePartAudioBody = z.infer<typeof generatePartAudioBodySchema>;

export const generateWorkAudioBodySchema = z.object({
  roles: z.array(z.enum(ttsVoiceRoleValues)).min(1).max(2).optional(),
  force: z.boolean().optional(),
});

export type GenerateWorkAudioBody = z.infer<typeof generateWorkAudioBodySchema>;

/**
 * One timeline segment for part audio.
 * New writes are timing-only (no `storageKey`); legacy rows may still include a
 * segment object key during the chapter-only migration window.
 */
export const audioTimelineSegmentSchema = z.object({
  index: z.number().int().nonnegative(),
  textHash: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  /** @deprecated Legacy segment object key; omit for timing-only / chapter-only assets. */
  storageKey: z.string().min(1).optional(),
  wordTimings: z.array(ttsWordTimingSchema),
});

export type AudioTimelineSegment = z.infer<typeof audioTimelineSegmentSchema>;

/**
 * JSON `content_asset.meta` contract (audio and non-audio kinds).
 * Unknown legacy keys pass through so old rows do not fail whole-asset parsing.
 */
export const contentAssetMetaSchema = z
  .object({
    voice: z.string().optional(),
    durationMs: z.number().nonnegative().optional(),
    lastError: z.string().optional(),
    generatedAt: z.string().optional(),
    /** audio_* — word-timing segments (storageKey optional / timing-only). */
    timeline: z.array(audioTimelineSegmentSchema).optional(),
    /**
     * Formal persisted object-storage keys only (e.g. chapter.mp3).
     * Do not list ephemeral or never-persisted segment keys.
     */
    objectKeys: z.array(z.string()).optional(),
    /** Origin file uploads (kind = origin_file). */
    originalFileName: z.string().optional(),
    size: z.number().nonnegative().optional(),
    /** Original path inside the source EPUB (image / cover assets). */
    originalPath: z.string().optional(),
    /** True when the upload reused an already-stored object (dedupe / instant upload). */
    reused: z.boolean().optional(),
  })
  .passthrough();

export type ContentAssetMeta = z.infer<typeof contentAssetMetaSchema>;

/** UI track status — `stale` is ready + contentHash mismatch (not a DB status). */
export const contentAssetTrackSchema = z.object({
  role: z.enum(ttsVoiceRoleValues),
  status: z.enum(['none', 'generating', 'ready', 'failed', 'stale']),
  voice: z.string().nullable(),
  contentHash: z.string().nullable(),
  contentStale: z.boolean(),
  mimeType: z.string().nullable(),
  lastError: z.string().nullable(),
  generatedAt: z.union([z.string(), z.date()]).nullable(),
  updatedAt: z.union([z.string(), z.date()]).nullable(),
  audioAvailable: z.boolean(),
  /** Asset id for `/api/assets/:id` when playable. */
  assetId: z.string().nullable(),
  audioUrl: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  timeline: z.array(audioTimelineSegmentSchema).optional(),
});

export type ContentAssetTrack = z.infer<typeof contentAssetTrackSchema>;

export const partAudioViewSchema = z.object({
  partId: z.string(),
  workId: z.string(),
  title: z.string(),
  currentContentHash: z.string(),
  tracks: z.object({
    us: contentAssetTrackSchema,
    uk: contentAssetTrackSchema,
  }),
});

export type PartAudioView = z.infer<typeof partAudioViewSchema>;

export const workAudioPartRowSchema = z.object({
  partId: z.string(),
  sortOrder: z.number().int(),
  title: z.string(),
  currentContentHash: z.string(),
  track: contentAssetTrackSchema,
});

export type WorkAudioPartRow = z.infer<typeof workAudioPartRowSchema>;

export const workAudioSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  none: z.number().int().nonnegative(),
  generating: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export type WorkAudioSummary = z.infer<typeof workAudioSummarySchema>;

export const workAudioViewSchema = z.object({
  workId: z.string(),
  role: z.enum(ttsVoiceRoleValues),
  summary: workAudioSummarySchema,
  parts: z.array(workAudioPartRowSchema),
});

export type WorkAudioView = z.infer<typeof workAudioViewSchema>;

export const workAudioQuerySchema = z.object({
  role: z.enum(ttsVoiceRoleValues),
});

export type WorkAudioQuery = z.infer<typeof workAudioQuerySchema>;

export const enqueueAudioItemSchema = z.object({
  partId: z.string(),
  role: z.enum(ttsVoiceRoleValues),
  jobId: z.string(),
});

export const skipAudioItemSchema = z.object({
  partId: z.string(),
  role: z.enum(ttsVoiceRoleValues),
  reason: z.enum(['fresh']),
});

export const enqueueAudioResultSchema = z.object({
  workId: z.string(),
  enqueued: z.array(enqueueAudioItemSchema),
  skipped: z.array(skipAudioItemSchema),
});

export type EnqueueAudioResult = z.infer<typeof enqueueAudioResultSchema>;
