import { loadInstanceTtsConfigRow, type TtsConfigRow } from '@/domains/provider-scope';

export const TTS_CONFIG_ID = 'default';

export type { TtsConfigRow };

/** Instance-scoped TTS row (admin / platform jobs). */
export async function loadConfigRow(): Promise<TtsConfigRow | null> {
  return loadInstanceTtsConfigRow();
}
