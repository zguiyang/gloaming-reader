import { asc, eq } from 'drizzle-orm';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';
import {
  buildPartAudioText,
  type EnqueueAudioResult,
  type GeneratePartAudioBody,
  type GenerateWorkAudioBody,
} from '@gloaming/shared/content-assets';
import { type TtsVoiceRole } from '@gloaming/shared/tts';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError, NotFoundError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { htmlToPlainText } from '@/lib/part-text';
import { enqueue } from '@/lib/queue';
import { hashPartAudioContent } from '@/modules/works/content-hash';

import { needsRegen } from '../service';
import { claimPartAudioGeneration, releasePartAudioGenerationClaim } from './generation-claim';

/** Must match `JOB_PART_AUDIO_GENERATE` in jobs/part-audio-generate.ts */
const PART_AUDIO_JOB = 'part-audio-generate';

/** BullMQ custom job ids must not contain `:`; generationKey embeds role separators. */
function partAudioQueueJobId(generationToken: string): string {
  return `${PART_AUDIO_JOB}-${generationToken}`;
}

const ALL_ROLES: TtsVoiceRole[] = ['us', 'uk'];

function resolveRoles(roles: TtsVoiceRole[] | undefined): TtsVoiceRole[] {
  if (!roles?.length) {
    return [...ALL_ROLES];
  }
  return [...new Set(roles)];
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

export async function enqueuePartAudio(partId: string, body: GeneratePartAudioBody): Promise<EnqueueAudioResult> {
  const part = await loadPart(partId);
  const text = buildPartAudioText(htmlToPlainText(part.body));
  if (!text.trim()) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.CONTENT_ASSET.NO_TEXT_TO_SYNTHESIZE);
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
          jobId: partAudioQueueJobId(claim.generationToken),
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
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
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
            jobId: partAudioQueueJobId(claim.generationToken),
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
