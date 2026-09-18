import { eq } from 'drizzle-orm';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';
import { buildPartAudioText } from '@gloaming/shared/content-assets';
import { type TtsVoiceRole } from '@gloaming/shared/tts';

import { db } from '@/db';
import { htmlToPlainText } from '@/lib/part-text';
import { completeWorkflowStep } from '@/lib/workflow';
import { TTS_STEP_ENABLED } from '@/lib/workflow-policy';
import { hashPartAudioContent } from '@/modules/works/content-hash';

import { needsRegen } from '../service';

const ALL_ROLES: TtsVoiceRole[] = ['us', 'uk'];

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
