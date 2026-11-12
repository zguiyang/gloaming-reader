import { describe, expect, it } from 'vitest';

import {
  buildReaderAudioConfigFingerprint,
  buildReaderAudioIdentity,
  readerAudioScopeKey,
} from '@/domains/reader-audio/identity';
import { SEGMENT_PIPELINE_VERSION } from '@/domains/reader-audio/segmenter';

const baseInput = {
  partId: 'part-123',
  role: 'us' as const,
  scopeKey: 'instance',
  ownerUserId: null as string | null,
  provider: 'azure',
  region: 'eastus',
  voice: 'en-US-JennyNeural',
  segmentHash: 'a'.repeat(64),
};

describe('readerAudioScopeKey', () => {
  it('uses the instance scope for the platform configuration', () => {
    expect(readerAudioScopeKey(null)).toBe('instance');
  });

  it('hashes user ids so scopes never leak the raw value', () => {
    const userId = 'c1b2d3e4-user-id';
    const scopeKey = readerAudioScopeKey(userId);
    expect(scopeKey.startsWith('user:')).toBe(true);
    expect(scopeKey).toHaveLength('user:'.length + 16);
    expect(scopeKey).not.toContain(userId);
    // Deterministic and isolating.
    expect(readerAudioScopeKey(userId)).toBe(scopeKey);
    expect(readerAudioScopeKey('another-user-id')).not.toBe(scopeKey);
  });
});

describe('buildReaderAudioConfigFingerprint', () => {
  it('is a 16-hex fingerprint pinned to pipeline version', () => {
    const fingerprint = buildReaderAudioConfigFingerprint({
      provider: 'azure',
      region: 'eastus',
      voice: 'en-US-JennyNeural',
    });
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(buildReaderAudioConfigFingerprint({ provider: 'azure', region: 'eastus', voice: 'en-US-JennyNeural' })).toBe(
      fingerprint,
    );
    expect(SEGMENT_PIPELINE_VERSION).toBe('reader-audio-v1');
  });

  it('changes when the voice, region, or provider changes', () => {
    const base = { provider: 'azure', region: 'eastus', voice: 'en-US-JennyNeural' };
    const fingerprint = buildReaderAudioConfigFingerprint(base);
    expect(buildReaderAudioConfigFingerprint({ ...base, voice: 'en-GB-SoniaNeural' })).not.toBe(fingerprint);
    expect(buildReaderAudioConfigFingerprint({ ...base, region: 'westeurope' })).not.toBe(fingerprint);
    expect(buildReaderAudioConfigFingerprint({ ...base, provider: 'other' })).not.toBe(fingerprint);
  });
});

describe('buildReaderAudioIdentity', () => {
  it('derives a scoped storage key without plaintext user ids or credentials', () => {
    const userId = 'deadbeef-user-id';
    const identity = buildReaderAudioIdentity({
      ...baseInput,
      scopeKey: readerAudioScopeKey(userId),
      ownerUserId: userId,
    });
    expect(identity.storageKey).toBe(
      `reader-audio/user-${readerAudioScopeKey(userId).slice('user:'.length)}/part-123/us/` +
        `${identity.configFingerprint}/${baseInput.segmentHash}.mp3`,
    );
    expect(identity.storageKey).not.toContain(userId);
    expect(identity.storageKey).not.toContain(baseInput.voice);
  });

  it('isolates instance and user scopes for the same segment hash', () => {
    const instanceIdentity = buildReaderAudioIdentity(baseInput);
    const userId = 'some-user-id';
    const userIdentity = buildReaderAudioIdentity({
      ...baseInput,
      scopeKey: readerAudioScopeKey(userId),
      ownerUserId: userId,
    });
    expect(userIdentity.storageKey).not.toBe(instanceIdentity.storageKey);
    expect(userIdentity.configFingerprint).toBe(instanceIdentity.configFingerprint);
    expect(userIdentity.scopeKey).not.toBe(instanceIdentity.scopeKey);
  });

  it('separates roles and config fingerprints in storage keys', () => {
    const us = buildReaderAudioIdentity(baseInput);
    const ukVoice = buildReaderAudioIdentity({ ...baseInput, role: 'uk', voice: 'en-GB-SoniaNeural' });
    expect(ukVoice.storageKey).not.toBe(us.storageKey);
    expect(ukVoice.configFingerprint).not.toBe(us.configFingerprint);
  });
});
