import { createHash } from 'node:crypto';

import { and, eq, gt } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  type ContentAssetMeta,
  readingPart as readingPartTable,
} from '@gloaming/db';
import { audioKindForRole, buildContentAssetGenerationKey, buildPartAudioText } from '@gloaming/shared/content-assets';
import { type TtsVoiceRole } from '@gloaming/shared/tts';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError, NotFoundError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { htmlToPlainText } from '@/lib/part-text';
import { putObject } from '@/modules/oss';
import { recordTtsInvocation } from '@/modules/tts/log';
import { synthesizeTts } from '@/modules/tts/synthesis/service';
import { hashPartAudioContent } from '@/modules/works/content-hash';

import { concatMp3Buffers } from './audio-concat';
import {
  assertAndRenewGenerationLease,
  assertGenerationOwnership,
  cleanupOrphanObjectsAfterOwnershipLoss,
  deletePartAudioObjectKeys,
  GenerationOwnershipLostError,
} from './generation-claim';
import { partAudioChapterKey } from './keys';
import { splitForTts } from './part-audio-split';
import { tryAdvanceTtsWorkflow } from './workflow-tts-advance';

const AUDIO_MIME = 'audio/mpeg';

type AssetRow = typeof contentAssetTable.$inferSelect;

export type PartAudioGenerateInput = {
  workId: string;
  partId: string;
  role: TtsVoiceRole;
  force: boolean;
  generationKey: string;
  generationToken: string;
  previousKeys?: string[];
  userId?: string;
};

function segmentTextHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** Azure / legacy meta may store fractional ms; client Zod schemas require ints. */
function intMs(n: number): number {
  return Math.round(n);
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
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
  }
  return row;
}

/** Worker entry — synthesize segments, concat chapter, upsert asset. */
export async function runPartAudioGenerate(input: PartAudioGenerateInput): Promise<void> {
  const part = await loadPart(input.partId);
  if (part.workId !== input.workId) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.CONTENT_ASSET.PART_NOT_IN_WORK);
  }

  const text = buildPartAudioText(htmlToPlainText(part.body));
  if (!text.trim()) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.CONTENT_ASSET.NO_TEXT_TO_SYNTHESIZE);
  }

  const contentHash = hashPartAudioContent(part.body);
  const kind = audioKindForRole(input.role);
  const generationKey = buildContentAssetGenerationKey({ partId: input.partId, kind, contentHash });
  if (generationKey !== input.generationKey) {
    return;
  }
  const segments = splitForTts(text);
  if (segments.length === 0) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.CONTENT_ASSET.NO_TEXT_TO_SYNTHESIZE);
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
  const timeline: NonNullable<ContentAssetMeta['timeline']> = [];
  let voice = '';
  let cursorMs = 0;
  let textCursor = 0;
  let allSegmentsCached = true;

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
      allSegmentsCached = allSegmentsCached && result.cached;
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
      timeline,
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
      await deletePartAudioObjectKeys(obsoleteKeys, { partId: input.partId, role: input.role });
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
      cached: allSegmentsCached,
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
      await deletePartAudioObjectKeys(objectKeys, { partId: input.partId, role: input.role, orphan: true });
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
