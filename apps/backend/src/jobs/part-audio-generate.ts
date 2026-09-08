import type { TtsVoiceRole } from '@gloaming/shared/tts';

import { runPartAudioGenerate } from '@/modules/content-assets/service';

export const JOB_PART_AUDIO_GENERATE = 'part-audio-generate';

export type PartAudioGenerateJobData = {
  workId: string;
  partId: string;
  role: TtsVoiceRole;
  force: boolean;
  generationKey: string;
  generationToken: string;
  userId?: string;
};

export async function processPartAudioGenerate(data: PartAudioGenerateJobData): Promise<{ ok: true }> {
  await runPartAudioGenerate(data);
  return { ok: true };
}
