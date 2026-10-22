import type { TtsVoiceRole } from '@gloaming/shared/tts';

import type { TtsConfigRow } from '@/domains/provider-scope';
import { resolveScopedTtsConfigRow, runtimeActorFromUserId } from '@/domains/provider-scope';
import { readerAudioScopeKey } from '@/domains/reader-audio/identity';
import type { WorkReadActor } from '@/domains/works/access';

export type ReaderAudioConfig = {
  row: TtsConfigRow;
  /** `instance` or `user:<sha256-16>` — derived from the resolved row owner. */
  scopeKey: string;
  ownerUserId: string | null;
  voice: string;
};

/**
 * Resolve the TTS configuration this actor would be charged for: user-first,
 * then instance (the shared provider-scope policy). Unusable or disabled rows
 * resolve to null — the caller decides the API semantics (unconfigured vs 503).
 */
export async function resolveReaderAudioConfig(
  actor: WorkReadActor,
  role: TtsVoiceRole,
): Promise<ReaderAudioConfig | null> {
  const row = await resolveScopedTtsConfigRow(runtimeActorFromUserId(actor.userId ?? undefined));
  if (!row) {
    return null;
  }
  const voice = role === 'us' ? row.usVoice : row.ukVoice;
  // A role without a usable voice is an unconfigured TTS — never call Azure with it.
  if (!voice || !voice.trim()) {
    return null;
  }
  return {
    row,
    scopeKey: readerAudioScopeKey(row.ownerUserId),
    ownerUserId: row.ownerUserId,
    voice,
  };
}
