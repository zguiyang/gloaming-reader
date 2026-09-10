import { createHash, randomUUID } from 'node:crypto';

import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  type ContentAssetMeta,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
} from '@gloaming/db';
import {
  audioKindForRole,
  buildContentAssetGenerationKey,
  buildPartAudioText,
  type ContentAssetTrack,
  type EnqueueAudioResult,
  type GeneratePartAudioBody,
  type GenerateWorkAudioBody,
  type PartAudioView,
  roleForAudioKind,
  type WorkAudioSummary,
  type WorkAudioView,
} from '@gloaming/shared/content-assets';
import { type ReaderAudioTrack } from '@gloaming/shared/reader';
import { type TtsVoiceRole } from '@gloaming/shared/tts';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { concatMp3Buffers } from '@/lib/audio-concat';
import { AppError, NotFoundError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import { splitForTts } from '@/lib/part-audio-split';
import { htmlToPlainText } from '@/lib/part-text';
import { enqueue } from '@/lib/queue';
import { completeWorkflowStep } from '@/lib/workflow';
import { TTS_STEP_ENABLED } from '@/lib/workflow-policy';
import { deleteObject, objectExists, putObject } from '@/modules/oss';
import { recordTtsInvocation } from '@/modules/tts/log';
import { synthesizeTts } from '@/modules/tts/service';
import { hashPartAudioContent } from '@/modules/works/content-hash';

/** Must match `JOB_PART_AUDIO_GENERATE` in jobs/part-audio-generate.ts */
const PART_AUDIO_JOB = 'part-audio-generate';
const partAudioLogger = rootLogger.child({ module: 'ContentAssets' });

const ALL_ROLES: TtsVoiceRole[] = ['us', 'uk'];
const AUDIO_MIME = 'audio/mpeg';
const AUDIO_GENERATION_LEASE_MS = 15 * 60 * 1000;

type AssetRow = typeof contentAssetTable.$inferSelect;

type AudioGenerationClaim = {
  generationKey: string;
  generationToken: string;
  generationClaimedAt: Date;
  generationLeaseExpiresAt: Date;
  assetId: string;
  previousKeys: string[];
  previousAsset?: {
    status: AssetRow['status'];
    storageKey: string | null;
    mimeType: string;
    contentHash: string | null;
    generationKey: string | null;
    meta: ContentAssetMeta;
  };
};

class GenerationOwnershipLostError extends Error {
  constructor() {
    super('Audio generation ownership was lost');
    this.name = 'GenerationOwnershipLostError';
  }
}

export function partAudioChapterKey(partId: string, kind: string, contentHash: string): string {
  return `part-audio/${partId}/${kind}/${contentHash}/chapter.mp3`;
}

export function partAudioSegmentKey(partId: string, kind: string, contentHash: string, index: number): string {
  return `part-audio/${partId}/${kind}/${contentHash}/seg/${String(index).padStart(4, '0')}.mp3`;
}

/** Alias for chapter key — tests and callers that used the old single-file path. */
export function partAudioObjectKey(partId: string, kind: string, contentHash: string): string {
  return partAudioChapterKey(partId, kind, contentHash);
}

function resolveRoles(roles: TtsVoiceRole[] | undefined): TtsVoiceRole[] {
  if (!roles?.length) {
    return [...ALL_ROLES];
  }
  return [...new Set(roles)];
}

function segmentTextHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function assetUrl(assetId: string): string {
  return `/api/assets/${assetId}`;
}

async function deleteObjectKeys(keys: string[], context: Record<string, unknown>): Promise<void> {
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch (error) {
      partAudioLogger.warn({ err: error, key, ...context }, 'Failed to delete audio object');
    }
  }
}

export function collectAudioObjectKeys(asset: { storageKey: string | null; meta: ContentAssetMeta }): string[] {
  const keys = [
    asset.storageKey,
    ...(asset.meta.objectKeys ?? []),
    // Legacy timeline.storageKey (pre chapter-only upload) — keep for cleanup of old assets.
    ...(asset.meta.timeline ?? []).map((segment) => segment.storageKey),
  ];
  return [...new Set(keys.filter((key): key is string => Boolean(key)))];
}

function audioObjectKeys(asset: { storageKey: string | null; meta: ContentAssetMeta }): string[] {
  return collectAudioObjectKeys(asset);
}

/** Formal stored objects only (column storageKey + meta.objectKeys) — not legacy timeline keys. */
function formalAudioObjectKeys(asset: { storageKey: string | null; meta: ContentAssetMeta }): string[] {
  const keys = [asset.storageKey, ...(asset.meta.objectKeys ?? [])];
  return [...new Set(keys.filter((key): key is string => Boolean(key)))];
}

export async function deleteAudioAssetObjects(asset: {
  kind: string;
  storageKey: string;
  meta: ContentAssetMeta;
}): Promise<void> {
  if (!asset.kind.startsWith('audio_')) {
    await deleteObject(asset.storageKey);
    return;
  }
  await deleteObjectKeys(audioObjectKeys(asset), { kind: asset.kind });
}

async function loadPart(partId: string): Promise<{
  id: string;
  workId: string;
  title: string;
  body: string;
  sortOrder: number;
}> {
  const rows = await db
    .select({
      id: readingPartTable.id,
      workId: readingPartTable.workId,
      title: readingPartTable.title,
      body: readingPartTable.body,
      sortOrder: readingPartTable.sortOrder,
    })
    .from(readingPartTable)
    .where(eq(readingPartTable.id, partId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError('Part');
  }
  return row;
}

function emptyTrack(role: TtsVoiceRole): ContentAssetTrack {
  return {
    role,
    status: 'none',
    voice: null,
    contentHash: null,
    contentStale: false,
    mimeType: null,
    lastError: null,
    generatedAt: null,
    updatedAt: null,
    audioAvailable: false,
    assetId: null,
    audioUrl: null,
    durationMs: null,
  };
}

/** Azure / legacy meta may store fractional ms; client Zod schemas require ints. */
function intMs(n: number): number {
  return Math.round(n);
}

function timelineForApi(timeline: NonNullable<ContentAssetMeta['timeline']>): ContentAssetTrack['timeline'] {
  return timeline.map((seg) => ({
    ...seg,
    startMs: intMs(seg.startMs),
    durationMs: intMs(seg.durationMs),
    wordTimings: seg.wordTimings.map((w) => ({
      ...w,
      audioOffsetMs: intMs(w.audioOffsetMs),
      durationMs: intMs(w.durationMs),
    })),
  }));
}

function toTrack(role: TtsVoiceRole, currentContentHash: string, asset: AssetRow | null): ContentAssetTrack {
  if (!asset) {
    return emptyTrack(role);
  }

  const meta = asset.meta ?? {};
  const contentStale = asset.contentHash !== currentContentHash;
  let status: ContentAssetTrack['status'];
  if (asset.status === 'generating') {
    status = 'generating';
  } else if (asset.status === 'failed') {
    status = 'failed';
  } else if (asset.status === 'ready' && contentStale) {
    status = 'stale';
  } else if (asset.status === 'ready') {
    status = 'ready';
  } else {
    status = 'failed';
  }

  const playable = status === 'ready';
  return {
    role,
    status,
    voice: meta.voice ?? null,
    contentHash: asset.contentHash,
    contentStale,
    mimeType: asset.mimeType,
    lastError: meta.lastError ?? null,
    generatedAt: meta.generatedAt ?? null,
    updatedAt: asset.updatedAt.toISOString(),
    audioAvailable: playable,
    assetId: playable ? asset.id : null,
    audioUrl: playable ? assetUrl(asset.id) : null,
    durationMs: meta.durationMs != null ? intMs(meta.durationMs) : null,
    timeline: playable && meta.timeline ? timelineForApi(meta.timeline) : undefined,
  };
}

export async function getPartAudio(partId: string): Promise<PartAudioView> {
  const part = await loadPart(partId);
  const currentContentHash = hashPartAudioContent(part.body);
  const metaRows = await db.select().from(contentAssetTable).where(eq(contentAssetTable.partId, partId));
  const metaByKind = new Map<string, AssetRow>();
  for (const row of metaRows) {
    if (row.kind === 'audio_us' || row.kind === 'audio_uk') {
      metaByKind.set(row.kind, row);
    }
  }

  return {
    partId: part.id,
    workId: part.workId,
    title: part.title,
    currentContentHash,
    tracks: {
      us: toTrack('us', currentContentHash, metaByKind.get('audio_us') ?? null),
      uk: toTrack('uk', currentContentHash, metaByKind.get('audio_uk') ?? null),
    },
  };
}

function summarize(tracks: ContentAssetTrack[]): WorkAudioSummary {
  const summary: WorkAudioSummary = {
    total: tracks.length,
    none: 0,
    generating: 0,
    ready: 0,
    stale: 0,
    failed: 0,
  };
  for (const track of tracks) {
    summary[track.status] += 1;
  }
  return summary;
}

export async function getWorkAudio(workId: string, role: TtsVoiceRole): Promise<WorkAudioView> {
  const [work] = await db
    .select({ id: readingWorkTable.id })
    .from(readingWorkTable)
    .where(eq(readingWorkTable.id, workId))
    .limit(1);
  if (!work) {
    throw new NotFoundError('Work');
  }

  const parts = await db
    .select({
      id: readingPartTable.id,
      title: readingPartTable.title,
      body: readingPartTable.body,
      sortOrder: readingPartTable.sortOrder,
    })
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId))
    .orderBy(asc(readingPartTable.sortOrder));

  const partIds = parts.map((p) => p.id);
  const kind = audioKindForRole(role);
  const assets =
    partIds.length === 0
      ? []
      : await db
          .select()
          .from(contentAssetTable)
          .where(and(inArray(contentAssetTable.partId, partIds), eq(contentAssetTable.kind, kind)));
  const byPart = new Map(assets.map((row) => [row.partId!, row]));

  const rows = parts.map((part) => {
    const currentContentHash = hashPartAudioContent(part.body);
    return {
      partId: part.id,
      sortOrder: part.sortOrder,
      title: part.title,
      currentContentHash,
      track: toTrack(role, currentContentHash, byPart.get(part.id) ?? null),
    };
  });

  return {
    workId,
    role,
    summary: summarize(rows.map((r) => r.track)),
    parts: rows,
  };
}

/** Admin/enqueue only (`needsRegen`) — not used on the learner read path. */
async function objectsExistForAsset(asset: AssetRow): Promise<boolean> {
  const keys = formalAudioObjectKeys(asset);
  if (keys.length === 0) {
    return false;
  }
  for (const key of keys) {
    try {
      if (!(await objectExists(key))) {
        return false;
      }
    } catch (error) {
      partAudioLogger.warn({ err: error, key }, 'Object storage exists check failed');
      return false;
    }
  }
  return true;
}

export async function needsRegen(partId: string, role: TtsVoiceRole, contentHash: string): Promise<boolean> {
  const kind = audioKindForRole(role);
  const generationKey = buildContentAssetGenerationKey({ partId, kind, contentHash });
  const [asset] = await db
    .select()
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.partId, partId), eq(contentAssetTable.kind, kind)))
    .limit(1);
  if (!asset) {
    return true;
  }
  if (
    asset.status === 'generating' &&
    asset.generationKey === generationKey &&
    asset.generationLeaseExpiresAt &&
    asset.generationLeaseExpiresAt > new Date()
  ) {
    return false;
  }
  if (asset.status === 'failed') {
    return true;
  }
  if (asset.status !== 'ready' || asset.contentHash !== contentHash) {
    return true;
  }
  return !(await objectsExistForAsset(asset));
}

async function claimPartAudioGeneration(input: {
  partId: string;
  workId: string;
  role: TtsVoiceRole;
  contentHash: string;
  force: boolean;
  allowReady: boolean;
}): Promise<AudioGenerationClaim | null> {
  const kind = audioKindForRole(input.role);
  const generationKey = buildContentAssetGenerationKey({ partId: input.partId, kind, contentHash: input.contentHash });
  const chapterKey = partAudioChapterKey(input.partId, kind, input.contentHash);
  const claimedAt = new Date();
  const leaseExpiresAt = new Date(claimedAt.getTime() + AUDIO_GENERATION_LEASE_MS);
  const generationToken = randomUUID();

  const [inserted] = await db
    .insert(contentAssetTable)
    .values({
      id: randomUUID(),
      workId: input.workId,
      partId: input.partId,
      kind,
      status: 'generating',
      storageKey: chapterKey,
      mimeType: AUDIO_MIME,
      contentHash: input.contentHash,
      generationKey,
      generationToken,
      generationClaimedAt: claimedAt,
      generationLeaseExpiresAt: leaseExpiresAt,
      meta: { lastError: undefined, objectKeys: [], timeline: [] },
    })
    .onConflictDoNothing()
    .returning({ id: contentAssetTable.id });
  if (inserted) {
    return {
      generationKey,
      generationToken,
      generationClaimedAt: claimedAt,
      generationLeaseExpiresAt: leaseExpiresAt,
      assetId: inserted.id,
      previousKeys: [],
    };
  }

  const [existing] = await db
    .select()
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.partId, input.partId), eq(contentAssetTable.kind, kind)))
    .limit(1);
  if (!existing) {
    return null;
  }

  const previousKeys = audioObjectKeys(existing);
  const previousAsset = {
    status: existing.status,
    storageKey: existing.storageKey,
    mimeType: existing.mimeType,
    contentHash: existing.contentHash,
    generationKey: existing.generationKey,
    meta: existing.meta ?? {},
  } satisfies NonNullable<AudioGenerationClaim['previousAsset']>;

  const eligible = [
    eq(contentAssetTable.status, 'failed'),
    and(
      eq(contentAssetTable.status, 'generating'),
      or(
        isNull(contentAssetTable.generationLeaseExpiresAt),
        lte(contentAssetTable.generationLeaseExpiresAt, claimedAt),
      ),
    )!,
  ];
  if (input.force || input.allowReady) {
    eligible.push(eq(contentAssetTable.status, 'ready'));
  }

  const [claimed] = await db
    .update(contentAssetTable)
    .set({
      workId: input.workId,
      partId: input.partId,
      kind,
      status: 'generating',
      storageKey: chapterKey,
      mimeType: AUDIO_MIME,
      contentHash: input.contentHash,
      generationKey,
      generationToken,
      generationClaimedAt: claimedAt,
      generationLeaseExpiresAt: leaseExpiresAt,
      meta: {
        ...(existing?.meta ?? {}),
        lastError: undefined,
        objectKeys: [],
        timeline: undefined,
      } satisfies ContentAssetMeta,
    })
    .where(and(eq(contentAssetTable.id, existing.id), or(...eligible)))
    .returning({ id: contentAssetTable.id });

  if (!claimed) {
    return null;
  }
  return {
    generationKey,
    generationToken,
    generationClaimedAt: claimedAt,
    generationLeaseExpiresAt: leaseExpiresAt,
    assetId: claimed.id,
    previousKeys,
    previousAsset,
  };
}

async function releasePartAudioGenerationClaim(claim: AudioGenerationClaim, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const previous = claim.previousAsset;
  const restored = previous?.status === 'ready';
  await db
    .update(contentAssetTable)
    .set({
      status: restored ? 'ready' : 'failed',
      storageKey: restored ? (previous.storageKey ?? undefined) : undefined,
      mimeType: restored ? previous.mimeType : AUDIO_MIME,
      contentHash: restored ? (previous.contentHash ?? undefined) : undefined,
      generationKey: restored ? previous.generationKey : claim.generationKey,
      generationToken: null,
      generationClaimedAt: null,
      generationLeaseExpiresAt: null,
      meta: restored
        ? previous.meta
        : ({
            lastError: `Audio job enqueue failed: ${message}`,
            objectKeys: [],
            timeline: [],
          } satisfies ContentAssetMeta),
    })
    .where(
      and(
        eq(contentAssetTable.id, claim.assetId),
        eq(contentAssetTable.generationKey, claim.generationKey),
        eq(contentAssetTable.generationToken, claim.generationToken),
        eq(contentAssetTable.status, 'generating'),
      ),
    )
    .returning({ id: contentAssetTable.id });
}

export async function enqueuePartAudio(partId: string, body: GeneratePartAudioBody): Promise<EnqueueAudioResult> {
  const part = await loadPart(partId);
  const text = buildPartAudioText(htmlToPlainText(part.body));
  if (!text.trim()) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, 'Part has no text to synthesize');
  }

  const contentHash = hashPartAudioContent(part.body);
  const force = body.force === true;
  const roles = resolveRoles(body.roles);
  const enqueued: EnqueueAudioResult['enqueued'] = [];
  const skipped: EnqueueAudioResult['skipped'] = [];

  for (const role of roles) {
    if (!force && !(await needsRegen(partId, role, contentHash))) {
      skipped.push({ partId, role, reason: 'fresh' });
      continue;
    }
    const claim = await claimPartAudioGeneration({
      partId,
      workId: part.workId,
      role,
      contentHash,
      force,
      allowReady: true,
    });
    if (!claim) {
      skipped.push({ partId, role, reason: 'fresh' });
      continue;
    }
    let jobId: string;
    try {
      jobId = await enqueue(
        PART_AUDIO_JOB,
        {
          workId: part.workId,
          partId,
          role,
          force,
          generationKey: claim.generationKey,
          generationToken: claim.generationToken,
          previousKeys: claim.previousKeys,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          jobId: `${PART_AUDIO_JOB}:${claim.generationKey}:${claim.generationToken}`,
        },
      );
    } catch (error) {
      await releasePartAudioGenerationClaim(claim, error);
      throw error;
    }
    enqueued.push({ partId, role, jobId });
  }

  return { workId: part.workId, enqueued, skipped };
}

export async function enqueueWorkAudio(workId: string, body: GenerateWorkAudioBody): Promise<EnqueueAudioResult> {
  const [work] = await db
    .select({ id: readingWorkTable.id })
    .from(readingWorkTable)
    .where(eq(readingWorkTable.id, workId))
    .limit(1);
  if (!work) {
    throw new NotFoundError('Work');
  }

  const parts = await db
    .select({
      id: readingPartTable.id,
      title: readingPartTable.title,
      body: readingPartTable.body,
    })
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId))
    .orderBy(asc(readingPartTable.sortOrder));

  const force = body.force === true;
  const roles = resolveRoles(body.roles);
  const enqueued: EnqueueAudioResult['enqueued'] = [];
  const skipped: EnqueueAudioResult['skipped'] = [];

  for (const part of parts) {
    const text = buildPartAudioText(htmlToPlainText(part.body));
    if (!text.trim()) {
      continue;
    }
    const contentHash = hashPartAudioContent(part.body);
    for (const role of roles) {
      if (!force && !(await needsRegen(part.id, role, contentHash))) {
        skipped.push({ partId: part.id, role, reason: 'fresh' });
        continue;
      }
      const claim = await claimPartAudioGeneration({
        partId: part.id,
        workId,
        role,
        contentHash,
        force,
        allowReady: true,
      });
      if (!claim) {
        skipped.push({ partId: part.id, role, reason: 'fresh' });
        continue;
      }
      let jobId: string;
      try {
        jobId = await enqueue(
          PART_AUDIO_JOB,
          {
            workId,
            partId: part.id,
            role,
            force,
            generationKey: claim.generationKey,
            generationToken: claim.generationToken,
            previousKeys: claim.previousKeys,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            jobId: `${PART_AUDIO_JOB}:${claim.generationKey}:${claim.generationToken}`,
          },
        );
      } catch (error) {
        await releasePartAudioGenerationClaim(claim, error);
        throw error;
      }
      enqueued.push({ partId: part.id, role, jobId });
    }
  }

  return { workId, enqueued, skipped };
}

type PartAudioGenerateInput = {
  workId: string;
  partId: string;
  role: TtsVoiceRole;
  force: boolean;
  generationKey: string;
  generationToken: string;
  previousKeys?: string[];
  userId?: string;
};

async function assertGenerationOwnership(input: PartAudioGenerateInput, kind: string): Promise<AssetRow> {
  const [asset] = await db
    .select()
    .from(contentAssetTable)
    .where(
      and(
        eq(contentAssetTable.partId, input.partId),
        eq(contentAssetTable.kind, kind),
        eq(contentAssetTable.generationKey, input.generationKey),
        eq(contentAssetTable.generationToken, input.generationToken),
        eq(contentAssetTable.status, 'generating'),
        gt(contentAssetTable.generationLeaseExpiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!asset) {
    throw new GenerationOwnershipLostError();
  }
  return asset;
}

async function renewGenerationLease(input: PartAudioGenerateInput, kind: string): Promise<boolean> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + AUDIO_GENERATION_LEASE_MS);
  const [renewed] = await db
    .update(contentAssetTable)
    .set({ generationLeaseExpiresAt: leaseExpiresAt })
    .where(
      and(
        eq(contentAssetTable.partId, input.partId),
        eq(contentAssetTable.kind, kind),
        eq(contentAssetTable.generationKey, input.generationKey),
        eq(contentAssetTable.generationToken, input.generationToken),
        eq(contentAssetTable.status, 'generating'),
        gt(contentAssetTable.generationLeaseExpiresAt, now),
      ),
    )
    .returning({ id: contentAssetTable.id });
  return Boolean(renewed);
}

async function assertAndRenewGenerationLease(input: PartAudioGenerateInput, kind: string): Promise<void> {
  if (!(await renewGenerationLease(input, kind))) {
    throw new GenerationOwnershipLostError();
  }
}

async function cleanupOrphanObjectsAfterOwnershipLoss(
  input: PartAudioGenerateInput,
  kind: string,
  contentHash: string,
  objectKeys: string[],
): Promise<void> {
  if (objectKeys.length === 0) {
    return;
  }
  const [current] = await db
    .select({ contentHash: contentAssetTable.contentHash, generationToken: contentAssetTable.generationToken })
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.partId, input.partId), eq(contentAssetTable.kind, kind)))
    .limit(1);
  // Generation keys are deterministic by content. Never remove objects that a
  // newer owner may already have written for the same content hash.
  if (current?.generationToken !== input.generationToken && current?.contentHash === contentHash) {
    return;
  }
  await deleteObjectKeys(objectKeys, { partId: input.partId, role: input.role, orphan: true });
}

/** Worker entry — synthesize segments, concat chapter, upsert asset. */
export async function runPartAudioGenerate(input: PartAudioGenerateInput): Promise<void> {
  const part = await loadPart(input.partId);
  if (part.workId !== input.workId) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, 'Part does not belong to work');
  }

  const text = buildPartAudioText(htmlToPlainText(part.body));
  if (!text.trim()) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, 'Part has no text to synthesize');
  }

  const contentHash = hashPartAudioContent(part.body);
  const kind = audioKindForRole(input.role);
  const generationKey = buildContentAssetGenerationKey({ partId: input.partId, kind, contentHash });
  if (generationKey !== input.generationKey) {
    return;
  }
  const segments = splitForTts(text);
  if (segments.length === 0) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, 'Part has no text to synthesize');
  }

  let existing: AssetRow;
  try {
    existing = await assertGenerationOwnership(input, kind);
  } catch (error) {
    if (error instanceof GenerationOwnershipLostError) {
      return;
    }
    throw error;
  }

  const previousKeys = input.previousKeys ?? [];

  const started = Date.now();
  const objectKeys: string[] = [];
  const segBuffers: Buffer[] = [];
  // Timing-only segments; storageKey omitted until shared/db make it optional (Agent G).
  type TimingSegment = Omit<NonNullable<ContentAssetMeta['timeline']>[number], 'storageKey'> & {
    storageKey?: string;
  };
  const timeline: TimingSegment[] = [];
  let voice = '';
  let cursorMs = 0;
  let textCursor = 0;

  try {
    for (let i = 0; i < segments.length; i += 1) {
      const segText = segments[i]!;
      await assertAndRenewGenerationLease(input, kind);
      const result = await synthesizeTts({
        text: segText,
        role: input.role,
        source: 'admin.part_audio',
        userId: input.userId,
        bypassCache: input.force,
      });
      voice = result.voice;
      await assertAndRenewGenerationLease(input, kind);
      // Segments stay in memory (and concat temp dir); do not putObject(seg/*.mp3).
      segBuffers.push(result.audio);

      const durationMs = intMs(
        result.wordTimings.length > 0
          ? Math.max(...result.wordTimings.map((w) => w.audioOffsetMs + w.durationMs), 0)
          : Math.max(1, (result.audio.length * 8) / 32),
      );

      timeline.push({
        index: i,
        textHash: segmentTextHash(segText),
        startMs: cursorMs,
        durationMs,
        wordTimings: result.wordTimings.map((w) => ({
          ...w,
          audioOffsetMs: intMs(w.audioOffsetMs + cursorMs),
          durationMs: intMs(w.durationMs),
          textOffset: w.textOffset + textCursor,
        })),
      });
      cursorMs += durationMs;
      textCursor += segText.length + (i < segments.length - 1 ? 1 : 0);
    }

    await assertAndRenewGenerationLease(input, kind);
    const chapterBuffer = await concatMp3Buffers(segBuffers);
    const chapterKey = partAudioChapterKey(input.partId, kind, contentHash);
    await assertAndRenewGenerationLease(input, kind);
    await putObject({ key: chapterKey, body: chapterBuffer, contentType: AUDIO_MIME });
    objectKeys.push(chapterKey);

    const generatedAt = new Date().toISOString();
    const meta: ContentAssetMeta = {
      voice,
      durationMs: cursorMs,
      generatedAt,
      // Compatible until packages make timeline.storageKey optional.
      timeline: timeline as NonNullable<ContentAssetMeta['timeline']>,
      objectKeys,
    };

    const [completed] = await db
      .update(contentAssetTable)
      .set({
        workId: input.workId,
        partId: input.partId,
        kind,
        status: 'ready',
        storageKey: chapterKey,
        mimeType: AUDIO_MIME,
        contentHash,
        generationKey: input.generationKey,
        generationToken: null,
        generationClaimedAt: null,
        generationLeaseExpiresAt: null,
        meta,
      })
      .where(
        and(
          eq(contentAssetTable.id, existing.id),
          eq(contentAssetTable.generationKey, input.generationKey),
          eq(contentAssetTable.generationToken, input.generationToken),
          eq(contentAssetTable.status, 'generating'),
          gt(contentAssetTable.generationLeaseExpiresAt, new Date()),
        ),
      )
      .returning({ id: contentAssetTable.id });
    if (!completed) {
      throw new GenerationOwnershipLostError();
    }

    const obsoleteKeys = previousKeys.filter((key) => !objectKeys.includes(key));
    if (obsoleteKeys.length > 0) {
      await deleteObjectKeys(obsoleteKeys, { partId: input.partId, role: input.role });
    }

    await recordTtsInvocation({
      status: 'success',
      source: 'admin.part_audio',
      userId: input.userId,
      workId: input.workId,
      partId: input.partId,
      voice,
      role: input.role,
      textPreview: text,
      textLength: text.length,
      latencyMs: Date.now() - started,
      cached: false,
    });

    await tryAdvanceTtsWorkflow(input.workId);
  } catch (error) {
    if (error instanceof GenerationOwnershipLostError) {
      await cleanupOrphanObjectsAfterOwnershipLoss(input, kind, contentHash, objectKeys);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = error instanceof AppError ? String(error.statusCode) : '500';

    if (objectKeys.length > 0) {
      try {
        await assertGenerationOwnership(input, kind);
      } catch (ownershipError) {
        if (ownershipError instanceof GenerationOwnershipLostError) {
          await cleanupOrphanObjectsAfterOwnershipLoss(input, kind, contentHash, objectKeys);
          return;
        }
        throw ownershipError;
      }
      await deleteObjectKeys(objectKeys, { partId: input.partId, role: input.role, orphan: true });
    }

    const [failed] = await db
      .update(contentAssetTable)
      .set({
        workId: input.workId,
        partId: input.partId,
        kind,
        status: 'failed',
        storageKey: partAudioChapterKey(input.partId, kind, contentHash),
        mimeType: AUDIO_MIME,
        contentHash,
        generationKey: input.generationKey,
        generationToken: null,
        generationClaimedAt: null,
        generationLeaseExpiresAt: null,
        meta: {
          voice: voice || undefined,
          lastError: message,
          objectKeys: [],
          timeline: [],
          generatedAt: new Date().toISOString(),
          durationMs: 0,
        } satisfies ContentAssetMeta,
      })
      .where(
        and(
          eq(contentAssetTable.id, existing.id),
          eq(contentAssetTable.generationKey, input.generationKey),
          eq(contentAssetTable.generationToken, input.generationToken),
          eq(contentAssetTable.status, 'generating'),
          gt(contentAssetTable.generationLeaseExpiresAt, new Date()),
        ),
      )
      .returning({ id: contentAssetTable.id });
    if (!failed) {
      return;
    }

    await recordTtsInvocation({
      status: 'failure',
      errorCode,
      errorMessage: message,
      source: 'admin.part_audio',
      userId: input.userId,
      workId: input.workId,
      partId: input.partId,
      voice: voice || null,
      role: input.role,
      textPreview: text,
      textLength: text.length,
      latencyMs: Date.now() - started,
      cached: null,
    });

    throw error;
  }
}

export async function tryAdvanceTtsWorkflow(workId: string): Promise<void> {
  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  if (!work || work.status !== 'tts') {
    return;
  }
  // Auto-TTS pipeline off: never block publish on chapter audio.
  if (!TTS_STEP_ENABLED) {
    await completeWorkflowStep(workId, 'ready', undefined, 'tts');
    return;
  }

  const parts = await db
    .select({
      id: readingPartTable.id,
      title: readingPartTable.title,
      body: readingPartTable.body,
    })
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId));

  if (parts.length === 0) {
    await completeWorkflowStep(workId, 'ready', undefined, 'tts');
    return;
  }

  for (const part of parts) {
    const text = buildPartAudioText(htmlToPlainText(part.body));
    if (!text.trim()) {
      continue;
    }
    const contentHash = hashPartAudioContent(part.body);
    for (const role of ALL_ROLES) {
      if (await needsRegen(part.id, role, contentHash)) {
        return;
      }
    }
  }

  await completeWorkflowStep(workId, 'ready', undefined, 'tts');
}

export type PartAudioAvailability = { us: boolean; uk: boolean };

/** DB-only: ready + content hash match. Object presence is verified on GetObject. */
async function isTrackPlayable(
  part: { title: string; body: string },
  partId: string,
  role: TtsVoiceRole,
): Promise<boolean> {
  const sourceHash = hashPartAudioContent(part.body);
  const kind = audioKindForRole(role);
  const [asset] = await db
    .select()
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.partId, partId), eq(contentAssetTable.kind, kind)))
    .limit(1);
  return Boolean(asset && asset.status === 'ready' && asset.contentHash === sourceHash);
}

export async function getPartAudioAvailability(
  partId: string,
  title?: string,
  body?: string,
): Promise<PartAudioAvailability> {
  const part = title !== undefined && body !== undefined ? { title, body } : await loadPart(partId);
  const [us, uk] = await Promise.all([isTrackPlayable(part, partId, 'us'), isTrackPlayable(part, partId, 'uk')]);
  return { us, uk };
}

/**
 * Learner: published work only; refuses stale (contentHash mismatch).
 * Missing storage objects are not preflighted — `/api/assets/:id` GetObject returns 404.
 */
export async function getPublishedPartAudioTrack(partId: string, role: TtsVoiceRole): Promise<ReaderAudioTrack> {
  const [part] = await db
    .select({
      id: readingPartTable.id,
      title: readingPartTable.title,
      body: readingPartTable.body,
      workId: readingPartTable.workId,
    })
    .from(readingPartTable)
    .innerJoin(readingWorkTable, eq(readingPartTable.workId, readingWorkTable.id))
    .where(and(eq(readingPartTable.id, partId), eq(readingWorkTable.status, 'published')))
    .limit(1);

  if (!part) {
    throw new NotFoundError('Part');
  }

  const sourceHash = hashPartAudioContent(part.body);
  const kind = audioKindForRole(role);
  const [asset] = await db
    .select()
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.partId, partId), eq(contentAssetTable.kind, kind)))
    .limit(1);
  if (!asset || asset.status !== 'ready' || asset.contentHash !== sourceHash) {
    throw new NotFoundError('Part audio');
  }

  const meta = asset.meta ?? {};
  const wordTimings = (meta.timeline ?? []).flatMap((seg) =>
    seg.wordTimings.map((w) => ({
      ...w,
      audioOffsetMs: intMs(w.audioOffsetMs),
      durationMs: intMs(w.durationMs),
    })),
  );

  return {
    role,
    mimeType: asset.mimeType,
    voice: meta.voice ?? roleForAudioKind(kind),
    audioUrl: assetUrl(asset.id),
    assetId: asset.id,
    durationMs: meta.durationMs != null ? intMs(meta.durationMs) : null,
    wordTimings,
  };
}
