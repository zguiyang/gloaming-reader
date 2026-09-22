import type { TtsVoiceRole } from '@gloaming/shared/tts';

import { tryAdvanceTtsWorkflow } from '@/application/commands/advance-tts-workflow';
import { runPartAudioGenerate } from '@/domains/assets';

export const JOB_PART_AUDIO_GENERATE = 'part-audio-generate';

export type PartAudioGenerateJobData = {
  workId: string;
  partId: string;
  role: TtsVoiceRole;
  force: boolean;
  generationKey: string;
  generationToken: string;
  previousKeys?: string[];
  userId?: string;
};

export async function processPartAudioGenerate(data: PartAudioGenerateJobData): Promise<{ ok: true }> {
  const completed = await runPartAudioGenerate(data);
  if (completed) {
    await tryAdvanceTtsWorkflow(data.workId);
  }
  return { ok: true };
}
