import { randomUUID } from 'node:crypto';

import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';

import { contentAsset as contentAssetTable, type ContentAssetMeta } from '@gloaming/db';
import { audioKindForRole, buildContentAssetGenerationKey } from '@gloaming/shared/content-assets';
import { type TtsVoiceRole } from '@gloaming/shared/tts';

import { db } from '@/db';
import { rootLogger } from '@/lib/logger';
import { deleteObject } from '@/modules/oss';

import { allAudioObjectKeysForLegacyCleanup, partAudioChapterKey } from './keys';

const partAudioLogger = rootLogger.child({ module: 'ContentAssets' });

const AUDIO_MIME = 'audio/mpeg';
const AUDIO_GENERATION_LEASE_MS = 15 * 60 * 1000;

type AssetRow = typeof contentAssetTable.$inferSelect;

export type AudioGenerationClaim = {
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

export class GenerationOwnershipLostError extends Error {
  constructor() {
    super('Audio generation ownership was lost');
    this.name = 'GenerationOwnershipLostError';
  }
}

export type AudioGenerationLeaseInput = {
  partId: string;
  role: TtsVoiceRole;
  generationKey: string;
  generationToken: string;
};

function audioObjectKeys(asset: { storageKey: string | null; meta: ContentAssetMeta }): string[] {
  return allAudioObjectKeysForLegacyCleanup(asset);
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

export async function claimPartAudioGeneration(input: {
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

export async function releasePartAudioGenerationClaim(claim: AudioGenerationClaim, error: unknown): Promise<void> {
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

export async function assertGenerationOwnership(input: AudioGenerationLeaseInput, kind: string): Promise<AssetRow> {
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

async function renewGenerationLease(input: AudioGenerationLeaseInput, kind: string): Promise<boolean> {
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

export async function assertAndRenewGenerationLease(input: AudioGenerationLeaseInput, kind: string): Promise<void> {
  if (!(await renewGenerationLease(input, kind))) {
    throw new GenerationOwnershipLostError();
  }
}

export async function cleanupOrphanObjectsAfterOwnershipLoss(
  input: AudioGenerationLeaseInput,
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

export async function deletePartAudioObjectKeys(keys: string[], context: Record<string, unknown>): Promise<void> {
  await deleteObjectKeys(keys, context);
}
