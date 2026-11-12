import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TtsConfigRow } from '@/domains/provider-scope';
import { resolveScopedTtsConfigRow } from '@/domains/provider-scope';
import { resolveReaderAudioConfig } from '@/domains/reader-audio/config';
import type { WorkReadActor } from '@/domains/works/access';

vi.mock('@/domains/provider-scope', () => ({
  resolveScopedTtsConfigRow: vi.fn(),
  runtimeActorFromUserId: (userId?: string | null) =>
    userId ? { kind: 'authenticated' as const, userId } : { kind: 'anonymous' as const },
}));

const actor: WorkReadActor = { userId: 'user-1', role: 'authenticated' };

function ttsRow(overrides: Partial<TtsConfigRow> = {}): TtsConfigRow {
  return {
    id: 'cfg-1',
    ownerUserId: null,
    provider: 'azure',
    region: 'eastus',
    apiKeyCiphertext: 'cipher',
    isEnabled: true,
    defaultVoice: 'en-US-JennyNeural',
    usVoice: 'en-US-JennyNeural',
    ukVoice: 'en-GB-SoniaNeural',
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('resolveReaderAudioConfig', () => {
  beforeEach(() => {
    vi.mocked(resolveScopedTtsConfigRow).mockReset();
  });

  it('resolves null when no TTS configuration exists', async () => {
    vi.mocked(resolveScopedTtsConfigRow).mockResolvedValue(null);
    await expect(resolveReaderAudioConfig(actor, 'us')).resolves.toBeNull();
  });

  it('returns the role voice with scope metadata when configured', async () => {
    vi.mocked(resolveScopedTtsConfigRow).mockResolvedValue(ttsRow());
    const config = await resolveReaderAudioConfig(actor, 'uk');
    expect(config).toMatchObject({
      voice: 'en-GB-SoniaNeural',
      scopeKey: 'instance',
      ownerUserId: null,
    });
  });

  it('returns null when the role voice is empty instead of calling Azure with it', async () => {
    vi.mocked(resolveScopedTtsConfigRow).mockResolvedValue(ttsRow({ usVoice: '' }));
    await expect(resolveReaderAudioConfig(actor, 'us')).resolves.toBeNull();
  });

  it('returns null when the role voice is whitespace-only', async () => {
    vi.mocked(resolveScopedTtsConfigRow).mockResolvedValue(ttsRow({ usVoice: '   ' }));
    await expect(resolveReaderAudioConfig(actor, 'us')).resolves.toBeNull();
  });

  it('validates only the requested role', async () => {
    vi.mocked(resolveScopedTtsConfigRow).mockResolvedValue(ttsRow({ ukVoice: '' }));
    // `uk` blank must fail even though `us` is fine, and vice versa.
    await expect(resolveReaderAudioConfig(actor, 'uk')).resolves.toBeNull();
    vi.mocked(resolveScopedTtsConfigRow).mockResolvedValue(ttsRow({ usVoice: ' ' }));
    await expect(resolveReaderAudioConfig(actor, 'us')).resolves.toBeNull();
  });
});
