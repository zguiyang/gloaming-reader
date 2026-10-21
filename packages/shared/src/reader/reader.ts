import { z } from 'zod';

import { ttsVoiceRoleValues, ttsWordTimingSchema } from '../tts/index.ts';
import { partSummarySchema, workSchema } from '../works/index.ts';

export const READING_STATE_STATUSES = ['in_progress', 'completed'] as const;
export type ReadingStateStatus = (typeof READING_STATE_STATUSES)[number];
export const readingStateStatusSchema = z.enum(READING_STATE_STATUSES);
export const READING_STATE_STATUS_LABELS = {
  in_progress: 'In progress',
  completed: 'Completed',
} as const satisfies Record<ReadingStateStatus, string>;

/** Concurrent completion keeps the maximum; restart is the only reset operation. */
export const READING_STATE_COMPLETION_RULE = 'monotonic_except_explicit_restart' as const;
/** A valid incoming position replaces the current one; an absent position preserves it. */
export const READING_STATE_POSITION_RULE = 'valid_incoming_wins_missing_preserves_current' as const;
/** Concurrent first-create attempts keep the row that won the unique user/work constraint. */
export const READING_STATE_CREATE_CONFLICT_RULE = 'existing_row_wins' as const;

/** No chapters fully completed yet. */
export const NO_CHAPTERS_COMPLETED = -1 as const;

export const READING_STATE_ACTIONS = [
  'open',
  'complete_chapter',
  'navigate',
  'finish',
  'restart',
  'save_position',
] as const;
export type ReadingStateAction = (typeof READING_STATE_ACTIONS)[number];

/** Anchor kind for a within-part scroll position stored on `reading_state`. */
export const READING_STATE_ANCHOR_KIND = 'part_ratio' as const;

/**
 * Within-chapter position. `partId` is stored with the ratio so a stale anchor
 * can never be applied to a different current part.
 */
export const readingAnchorSchema = z.object({
  partId: z.string().min(1),
  /** 0 = top of the part, 1 = bottom. */
  ratio: z.number().min(0).max(1),
});

export type ReadingAnchor = z.infer<typeof readingAnchorSchema>;

export const readingStateSchema = z.object({
  status: readingStateStatusSchema,
  currentPartId: z.string().nullable(),
  completedThroughSortOrder: z.number().int(),
  /** Saved within-part position for `currentPartId`; null when none or unpaired. */
  anchor: readingAnchorSchema.nullable().optional(),
  /** DB revision for an optional compare-and-swap update; omitted by legacy responses. */
  revision: z.number().int().nonnegative().optional(),
  /** Computed for UI — not persisted. */
  progressRatio: z.number().int().min(0).max(100),
  totalPartCount: z.number().int().nonnegative(),
  lastReadAt: z.union([z.string(), z.date()]),
  completedAt: z.union([z.string(), z.date()]).nullable(),
});

export type ReadingState = z.infer<typeof readingStateSchema>;

export type PartSortOrder = { sortOrder: number };

export function mergeReadingPosition(input: {
  action: ReadingStateAction;
  currentPartId: string | null;
  requestedPartId?: string;
  restartPartId?: string;
}): string | null {
  if (input.action === 'restart') {
    return input.restartPartId ?? input.currentPartId;
  }
  return input.requestedPartId ?? input.currentPartId;
}

/** Completion never moves backward; restart is the explicit reset operation. */
export function mergeReadingCompletion(current: number, incoming: number): number {
  return Math.max(current, incoming);
}

/** Chapter-based progress: completed parts / total parts. */
export function computeChapterProgress(input: {
  status: ReadingStateStatus;
  completedThroughSortOrder: number;
  parts: PartSortOrder[];
}): number {
  if (input.status === 'completed') {
    return 100;
  }
  const total = input.parts.length;
  if (total <= 0) {
    return 0;
  }
  if (input.completedThroughSortOrder < NO_CHAPTERS_COMPLETED) {
    return 0;
  }
  const completedCount = input.parts.filter((part) => part.sortOrder <= input.completedThroughSortOrder).length;
  return Math.round((completedCount / total) * 100);
}

export const readerWorkSummarySchema = workSchema.pick({
  id: true,
  title: true,
  description: true,
  coverAssetId: true,
  publishedAt: true,
});

export type ReaderWorkSummary = z.infer<typeof readerWorkSummarySchema>;

export const readerCurrentPartSchema = z.object({
  id: z.string(),
  workId: z.string(),
  sortOrder: z.number().int(),
  kind: partSummarySchema.shape.kind,
  title: z.string(),
  body: z.string(),
});

export type ReaderCurrentPart = z.infer<typeof readerCurrentPartSchema>;

export const readerPartsDataSchema = z.object({
  work: readerWorkSummarySchema,
  parts: z.array(partSummarySchema),
});

export type ReaderPartsData = z.infer<typeof readerPartsDataSchema>;

export const readerPartDataSchema = z.object({
  work: readerWorkSummarySchema.pick({ id: true, title: true, coverAssetId: true }),
  part: readerCurrentPartSchema,
  /** Whether this actor has a usable TTS configuration (config check only — no synthesis). */
  ttsConfigured: z.boolean(),
});

export type ReaderPartData = z.infer<typeof readerPartDataSchema>;

export const readingStateDataSchema = z.object({
  state: readingStateSchema.nullable(),
});

export type ReadingStateData = z.infer<typeof readingStateDataSchema>;

/** Lazy per-paragraph audio: manifest lists derived segments without triggering synthesis. */
export const readerAudioManifestQuerySchema = z.object({
  role: z.enum(ttsVoiceRoleValues),
});

export type ReaderAudioManifestQuery = z.infer<typeof readerAudioManifestQuerySchema>;

export const readerAudioManifestSegmentSchema = z.object({
  index: z.number().int().min(0),
  key: z.string().min(1),
  segmentHash: z.string().min(1),
  paragraphAnchor: z.string(),
  paragraphTextOffset: z.number().int().min(0),
  textLength: z.number().int().min(0),
});

export type ReaderAudioManifestSegment = z.infer<typeof readerAudioManifestSegmentSchema>;

export const readerAudioManifestSchema = z.object({
  role: z.enum(ttsVoiceRoleValues),
  ttsConfigured: z.boolean(),
  configFingerprint: z.string().nullable(),
  segments: z.array(readerAudioManifestSegmentSchema),
});

export type ReaderAudioManifest = z.infer<typeof readerAudioManifestSchema>;

export const readerAudioSegmentQuerySchema = readerAudioManifestQuerySchema.extend({
  /** Stale-manifest guard: the caller's segment hash must still match the derived one. */
  expectedHash: z.string().min(16).max(128).optional(),
});

export type ReaderAudioSegmentQuery = z.infer<typeof readerAudioSegmentQuerySchema>;

export const readerAudioSegmentSchema = z.object({
  index: z.number().int().min(0),
  role: z.enum(ttsVoiceRoleValues),
  voice: z.string().min(1),
  mimeType: z.string().min(1),
  durationMs: z.number().int().min(0).nullable(),
  wordTimings: z.array(ttsWordTimingSchema),
  paragraphAnchor: z.string(),
  paragraphTextOffset: z.number().int().min(0),
  segmentHash: z.string().min(1),
  /** Auth-checked segment stream route — `/api/reader/parts/:partId/audio/segments/:index/audio`. */
  audioUrl: z.string().min(1),
});

export type ReaderAudioSegment = z.infer<typeof readerAudioSegmentSchema>;

export const updateReadingStateBodySchema = z
  .object({
    action: z.enum(READING_STATE_ACTIONS),
    partId: z.string().min(1).optional(),
    nextPartId: z.string().min(1).optional(),
    /** Required for `save_position`; rejected for every other action. */
    anchor: readingAnchorSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.action === 'save_position') {
      if (!body.anchor) {
        ctx.addIssue({
          code: 'custom',
          path: ['anchor'],
          message: 'anchor is required for save_position',
        });
      }
      if (body.partId || body.nextPartId) {
        ctx.addIssue({
          code: 'custom',
          path: ['anchor'],
          message: 'partId and nextPartId are not allowed for save_position',
        });
      }
    } else if (body.anchor) {
      ctx.addIssue({
        code: 'custom',
        path: ['anchor'],
        message: 'anchor is only allowed for save_position',
      });
    }
    if ((body.action === 'navigate' || body.action === 'open') && !body.partId) {
      if (body.action === 'navigate') {
        ctx.addIssue({
          code: 'custom',
          path: ['partId'],
          message: 'partId is required for navigate',
        });
      }
    }
    if (body.action === 'complete_chapter' && body.partId) {
      ctx.addIssue({
        code: 'custom',
        path: ['partId'],
        message: 'partId is not allowed for complete_chapter',
      });
    }
  });

export type UpdateReadingStateBody = z.infer<typeof updateReadingStateBodySchema>;

/** @deprecated Session aggregate removed — use readerPartsDataSchema + readerPartDataSchema + readingStateSchema */
export const readerSessionDataSchema = readerPartsDataSchema;
export type ReaderSessionData = ReaderPartsData;
