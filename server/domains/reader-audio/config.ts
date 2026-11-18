import type { TtsVoiceRole } from '@/shared/tts';

import type { TtsConfigRow } from '@/server/domains/provider-scope';
import { resolveInstanceTtsConfigRow } from '@/server/domains/provider-scope';
import { readerAudioScopeKey } from '@/server/domains/reader-audio/identity';
import { loadUserTtsVoiceRow } from '@/server/domains/tts/config/user-service';
import type { WorkReadActor } from '@/server/domains/works/access';

export type ReaderAudioConfig = {
  row: TtsConfigRow;
  /** Always instance scope — credentials never come from a user TTS row. */
  scopeKey: string;
  ownerUserId: string | null;
  voice: string;
};

/**
 * Instance TTS credentials + optional user voice overlay.
 * Unusable/disabled instance config resolves to null.
 */
export async function resolveReaderAudioConfig(
  actor: WorkReadActor,
  role: TtsVoiceRole,
): Promise<ReaderAudioConfig | null> {
  const instance = await resolveInstanceTtsConfigRow();
  if (!instance) {
    return null;
  }

  const prefs = await loadUserTtsVoiceRow(actor.userId);
  const usVoice = prefs?.usVoice?.trim() || instance.usVoice;
  const ukVoice = prefs?.ukVoice?.trim() || instance.ukVoice;
  const voice = role === 'us' ? usVoice : ukVoice;
  if (!voice || !voice.trim()) {
    return null;
  }

  return {
    row: instance,
    scopeKey: readerAudioScopeKey(instance.ownerUserId),
    ownerUserId: instance.ownerUserId,
    voice,
  };
}
