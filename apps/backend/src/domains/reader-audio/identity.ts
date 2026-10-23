import { createHash } from 'node:crypto';

import type { TtsVoiceRole } from '@gloaming/shared/tts';

import { SEGMENT_PIPELINE_VERSION } from '@/domains/reader-audio/segmenter';

export type ReaderAudioIdentityInput = {
  partId: string;
  role: TtsVoiceRole;
  scopeKey: string;
  ownerUserId: string | null;
  provider: string;
  region: string;
  voice: string;
  segmentHash: string;
};

/**
 * Fully-qualified segment identity. Carries every `part_audio_segment` unique
 * key column so repository lookups need no extra parameters.
 */
export type ReaderAudioIdentity = {
  partId: string;
  role: TtsVoiceRole;
  scopeKey: string;
  ownerUserId: string | null;
  configFingerprint: string;
  segmentHash: string;
  storageKey: string;
};

/** TTS configuration fingerprint — 16 hex chars of sha256(provider|region|voice|pipeline). */
export function buildReaderAudioConfigFingerprint(input: { provider: string; region: string; voice: string }): string {
  return createHash('sha256')
    .update(`${input.provider}|${input.region}|${input.voice}|${SEGMENT_PIPELINE_VERSION}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

/** Scope key for a TTS configuration owner — `instance` or `user:<sha256-16>`. Never expose the raw userId. */
export function readerAudioScopeKey(ownerUserId: string | null): string {
  if (!ownerUserId) {
    return 'instance';
  }
  return `user:${createHash('sha256').update(ownerUserId, 'utf8').digest('hex').slice(0, 16)}`;
}

/**
 * Resolve a segment's durable identity. The storage key is fully derived
 * (scope + part + role + config fingerprint + content hash) and contains no
 * plaintext userId, credential, or voice name.
 */
export function buildReaderAudioIdentity(input: ReaderAudioIdentityInput): ReaderAudioIdentity {
  const configFingerprint = buildReaderAudioConfigFingerprint(input);
  const storageKey =
    `reader-audio/${input.scopeKey.replace(':', '-')}/${input.partId}/${input.role}/` +
    `${configFingerprint}/${input.segmentHash}.mp3`;
  return {
    partId: input.partId,
    role: input.role,
    scopeKey: input.scopeKey,
    ownerUserId: input.ownerUserId,
    configFingerprint,
    segmentHash: input.segmentHash,
    storageKey,
  };
}

/** Claim-scoped objects keep stale synthesis uploads separate from the published winner. */
export function buildReaderAudioAttemptStorageKey(storageKey: string, token: string): string {
  return `${storageKey.slice(0, -4)}/${token}.mp3`;
}
