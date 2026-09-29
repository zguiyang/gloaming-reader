import { asc, eq } from 'drizzle-orm';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';
import { buildPartAudioText } from '@gloaming/shared/content-assets';
import { type TtsVoiceRole } from '@gloaming/shared/tts';

import { needsRegen } from '@/domains/assets/content/availability';
import { hashPartAudioContent, htmlToPlainText } from '@/domains/works/content';
import { db } from '@/infra/db';
import { enqueue } from '@/infra/queue';
import { NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

import { claimPartAudioGeneration, releasePartAudioGenerationClaim } from './generation-claim';

/** Must match `JOB_PART_AUDIO_GENERATE` in jobs/part-audio-generate.ts */
const PART_AUDIO_JOB = 'part-audio-generate';

/** BullMQ custom job ids must not contain `:`; generationKey embeds role separators. */
function partAudioQueueJobId(generationToken: string): string {
  return `${PART_AUDIO_JOB}-${generationToken}`;
}

const ALL_ROLES: TtsVoiceRole[] = ['us', 'uk'];
type WorkAudioGenerationOptions = { roles?: TtsVoiceRole[]; force?: boolean };

function resolveRoles(roles: TtsVoiceRole[] | undefined): TtsVoiceRole[] {
  if (!roles?.length) {
    return [...ALL_ROLES];
  }
  return [...new Set(roles)];
}

export async function enqueueWorkAudio(workId: string, body: WorkAudioGenerationOptions): Promise<void> {
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
  for (const part of parts) {
    const text = buildPartAudioText(htmlToPlainText(part.body));
    if (!text.trim()) {
      continue;
    }
    const contentHash = hashPartAudioContent(part.body);
    for (const role of roles) {
      if (!force && !(await needsRegen(part.id, role, contentHash))) {
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
        continue;
      }
      try {
        await enqueue(
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
    }
  }
}
