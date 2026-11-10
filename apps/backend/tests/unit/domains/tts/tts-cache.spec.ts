import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeTtsInput,
  TTS_CACHE_KEY_PREFIX_V1,
  TTS_CACHE_KEY_PREFIX_V2,
  TTS_CACHE_MAX_RAW_AUDIO_BYTES,
  TTS_CACHE_TTL_SECONDS,
} from '@gloaming/shared/tts';

import { buildTtsCacheKeyV2, normalizeTtsText, shouldWriteTtsCache, synthesizeTts } from '@/domains/tts';
import * as redisLib from '@/infra/cache';
import * as azureTts from '@/infra/tts/azure';

vi.mock('@/infra/db', () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('@/infra/llm', () => ({
  decryptApiKey: vi.fn(() => 'azure-key'),
  encryptApiKey: vi.fn((value: string) => `enc:${value}`),
  maskApiKey: vi.fn(() => '****'),
}));

import { db } from '@/infra/db';

function createMemoryRedis() {
  const store = new Map<string, { value: string; ttl?: number }>();
  return {
    store,
    client: {
      get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
      set: vi.fn(async (key: string, value: string, mode?: string, ttl?: number) => {
        store.set(key, { value, ttl: mode === 'EX' ? ttl : undefined });
        return 'OK';
      }),
    },
  };
}

describe('TTS Redis cache keys and size gate', () => {
  it('builds stable v2 keys with prefix and varies by voice and region', () => {
    const text = normalizeTtsText('  hello   world  ');
    const v2 = buildTtsCacheKeyV2(text, 'en-US-JennyNeural', 'eastasia');
    expect(v2.startsWith(TTS_CACHE_KEY_PREFIX_V2)).toBe(true);
    expect(buildTtsCacheKeyV2(text, 'en-US-JennyNeural', 'eastasia')).toBe(v2);
    expect(buildTtsCacheKeyV2(text, 'en-US-GuyNeural', 'eastasia')).not.toBe(v2);
    expect(buildTtsCacheKeyV2(text, 'en-US-JennyNeural', 'westus')).not.toBe(v2);
  });

  it('allows writes at the 2 MiB cap and rejects above it', () => {
    expect(shouldWriteTtsCache(TTS_CACHE_MAX_RAW_AUDIO_BYTES)).toBe(true);
    expect(shouldWriteTtsCache(TTS_CACHE_MAX_RAW_AUDIO_BYTES + 1)).toBe(false);
  });
});

describe('synthesizeTts Redis governance', () => {
  const configRow = {
    id: 'default',
    provider: 'azure',
    region: 'eastasia',
    apiKeyCiphertext: 'enc:azure-key',
    isEnabled: true,
    defaultVoice: 'en-US-JennyNeural',
    usVoice: 'en-US-JennyNeural',
    ukVoice: 'en-GB-SoniaNeural',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  let memory: ReturnType<typeof createMemoryRedis>;
  let redisSpy: ReturnType<typeof vi.spyOn>;
  let synthesizeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    memory = createMemoryRedis();
    redisSpy = vi.spyOn(redisLib, 'getRedis').mockReturnValue(memory.client as never);
    synthesizeSpy = vi.spyOn(azureTts, 'synthesizeAzureTts').mockResolvedValue({
      audio: Buffer.from('cached-mp3'),
      mimeType: 'audio/mpeg',
      wordTimings: [{ text: 'hello', audioOffsetMs: 0, durationMs: 120, textOffset: 0 }],
    });

    const limit = vi.fn().mockResolvedValue([configRow]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    vi.mocked(db.select).mockReturnValue({ from } as never);
  });

  afterEach(() => {
    redisSpy.mockRestore();
    synthesizeSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('writes v2 keys with absolute 7-day TTL and reports real hit/miss', async () => {
    const first = await synthesizeTts({ text: 'hello world', source: 'unit' });
    expect(first.cached).toBe(false);
    expect(synthesizeSpy).toHaveBeenCalledTimes(1);

    const v2Key = buildTtsCacheKeyV2('hello world', 'en-US-JennyNeural', 'eastasia');
    expect(memory.client.set).toHaveBeenCalledWith(v2Key, expect.any(String), 'EX', TTS_CACHE_TTL_SECONDS);
    expect(memory.store.get(v2Key)?.ttl).toBe(TTS_CACHE_TTL_SECONDS);
    expect([...memory.store.keys()].every((key) => key.startsWith(TTS_CACHE_KEY_PREFIX_V2))).toBe(true);

    synthesizeSpy.mockClear();
    const second = await synthesizeTts({ text: 'hello world', source: 'unit' });
    expect(second.cached).toBe(true);
    expect(synthesizeSpy).not.toHaveBeenCalled();
  });

  it('does not read legacy v1 keys and writes only v2 on miss', async () => {
    const v1Key = `${TTS_CACHE_KEY_PREFIX_V1}${'a'.repeat(64)}`;
    memory.store.set(v1Key, {
      value: JSON.stringify({
        mimeType: 'audio/mpeg',
        voice: 'en-US-JennyNeural',
        audioBase64: Buffer.from('legacy-mp3').toString('base64'),
        wordTimings: [],
      }),
      ttl: 1000,
    });

    const result = await synthesizeTts({ text: 'hello world', source: 'unit' });
    expect(result.cached).toBe(false);
    expect(result.audio.toString()).toBe('cached-mp3');
    expect(synthesizeSpy).toHaveBeenCalledTimes(1);
    expect(memory.store.has(v1Key)).toBe(true);
    const v2Key = buildTtsCacheKeyV2('hello world', 'en-US-JennyNeural', 'eastasia');
    expect(memory.store.has(v2Key)).toBe(true);
    expect(memory.client.set).toHaveBeenCalledWith(v2Key, expect.any(String), 'EX', TTS_CACHE_TTL_SECONDS);
  });

  it('skips Redis write when raw audio exceeds 2 MiB but still returns audio', async () => {
    const huge = Buffer.alloc(TTS_CACHE_MAX_RAW_AUDIO_BYTES + 1, 1);
    synthesizeSpy.mockResolvedValue({
      audio: huge,
      mimeType: 'audio/mpeg',
      wordTimings: [],
    });

    const result = await synthesizeTts({ text: 'big audio', source: 'unit' });
    expect(result.cached).toBe(false);
    expect(result.audio.byteLength).toBe(TTS_CACHE_MAX_RAW_AUDIO_BYTES + 1);
    expect(memory.client.set).not.toHaveBeenCalled();
  });

  it('continues to provider when Redis get throws', async () => {
    memory.client.get.mockRejectedValueOnce(new Error('redis down'));

    const result = await synthesizeTts({ text: 'hello world', source: 'unit' });
    expect(result.cached).toBe(false);
    expect(synthesizeSpy).toHaveBeenCalledTimes(1);
    expect(memory.client.set).toHaveBeenCalled();
  });

  it('re-maps cached word timings to the current request source offsets on cache hit', async () => {
    const altSource = 'A&B';
    const sharedSource = 'A and B';
    const alt = normalizeTtsInput(altSource);
    const shared = normalizeTtsInput(sharedSource);
    expect(shared.ttsText).toBe(alt.ttsText);

    const andOffsetInTts = alt.ttsText.indexOf('and');
    expect(andOffsetInTts).toBeGreaterThan(0);

    synthesizeSpy.mockResolvedValue({
      audio: Buffer.from('shared-mp3'),
      mimeType: 'audio/mpeg',
      wordTimings: [{ text: 'and', audioOffsetMs: 0, durationMs: 100, textOffset: andOffsetInTts }],
    });

    const first = await synthesizeTts({ text: altSource, source: 'unit' });
    expect(first.cached).toBe(false);
    expect(first.wordTimings).toHaveLength(1);
    expect(first.wordTimings[0]?.textOffset).toBe(alt.mapTtsOffsetToSource(andOffsetInTts));

    const v2Key = buildTtsCacheKeyV2(alt.ttsText, 'en-US-JennyNeural', 'eastasia');
    const cachedPayload = JSON.parse(memory.store.get(v2Key)!.value) as { wordTimings: { textOffset: number }[] };
    expect(cachedPayload.wordTimings[0]?.textOffset).toBe(andOffsetInTts);

    synthesizeSpy.mockClear();
    const second = await synthesizeTts({ text: sharedSource, source: 'unit' });
    expect(second.cached).toBe(true);
    expect(synthesizeSpy).not.toHaveBeenCalled();
    expect(second.wordTimings).toHaveLength(1);
    expect(second.wordTimings[0]?.textOffset).toBe(shared.mapTtsOffsetToSource(andOffsetInTts));
    expect(second.wordTimings[0]?.textOffset).not.toBe(first.wordTimings[0]?.textOffset);
  });

  it('returns audio but drops invalid word timings instead of failing synthesis', async () => {
    synthesizeSpy.mockResolvedValue({
      audio: Buffer.from('mp3-with-bad-timing'),
      mimeType: 'audio/mpeg',
      wordTimings: [{ text: 'amp;', audioOffsetMs: 0, durationMs: 100, textOffset: -1 }],
    });

    const result = await synthesizeTts({ text: 'hello', source: 'unit' });
    expect(result.audio.toString()).toBe('mp3-with-bad-timing');
    expect(result.wordTimings).toEqual([]);
    expect(result.cached).toBe(false);
  });
});
