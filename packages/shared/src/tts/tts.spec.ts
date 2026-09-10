import { describe, expect, it } from 'vitest';

import {
  TTS_CACHE_KEY_PREFIX_V1,
  TTS_CACHE_KEY_PREFIX_V2,
  TTS_CACHE_MAX_RAW_AUDIO_BYTES,
  TTS_CACHE_SCHEMA_VERSION,
  TTS_CACHE_TTL_SECONDS,
} from './tts.ts';

describe('TTS cache contract constants', () => {
  it('exposes v2 key prefix, schema version, 7-day TTL, and 2 MiB raw audio cap', () => {
    expect(TTS_CACHE_KEY_PREFIX_V1).toBe('gloaming:tts:v1:');
    expect(TTS_CACHE_KEY_PREFIX_V2).toBe('gloaming:tts:v2:');
    expect(TTS_CACHE_SCHEMA_VERSION).toBe(1);
    expect(TTS_CACHE_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(TTS_CACHE_MAX_RAW_AUDIO_BYTES).toBe(2 * 1024 * 1024);
  });
});
