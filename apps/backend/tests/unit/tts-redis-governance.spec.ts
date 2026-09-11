import { afterEach, describe, expect, it } from 'vitest';

import { TTS_CACHE_KEY_PREFIX_V1 } from '@gloaming/shared/tts';

function parseGovernanceArgs(argv: string[]) {
  const options = { prefix: 'both', deleteV1: false, execute: false };
  for (const arg of argv) {
    if (arg.startsWith('--prefix=')) {
      options.prefix = arg.slice('--prefix='.length) as typeof options.prefix;
      continue;
    }
    if (arg === '--delete-v1') options.deleteV1 = true;
    if (arg === '--execute') options.execute = true;
    if (arg === '--delete') throw new Error('Use --delete-v1 with --execute for legacy v1 cleanup');
  }
  return options;
}

function assertDeleteV1Authorized(options: ReturnType<typeof parseGovernanceArgs>) {
  if (!options.deleteV1) return;
  if (!options.execute) {
    throw new Error('Refusing --delete-v1 without --execute (default is dry-run report only)');
  }
  if (process.env.ALLOW_TTS_REDIS_V1_CLEANUP !== '1') {
    throw new Error('Refusing v1 deletion without ALLOW_TTS_REDIS_V1_CLEANUP=1 (explicit operator consent)');
  }
}

describe('tts redis governance policy', () => {
  const originalEnv = process.env.ALLOW_TTS_REDIS_V1_CLEANUP;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ALLOW_TTS_REDIS_V1_CLEANUP;
    } else {
      process.env.ALLOW_TTS_REDIS_V1_CLEANUP = originalEnv;
    }
  });

  it('requires execute and env consent for v1 deletion', () => {
    delete process.env.ALLOW_TTS_REDIS_V1_CLEANUP;
    expect(() => assertDeleteV1Authorized(parseGovernanceArgs(['--delete-v1']))).toThrow(/execute/);
    expect(() => assertDeleteV1Authorized(parseGovernanceArgs(['--delete-v1', '--execute']))).toThrow(/ALLOW_TTS/);
    process.env.ALLOW_TTS_REDIS_V1_CLEANUP = '1';
    expect(() => assertDeleteV1Authorized(parseGovernanceArgs(['--delete-v1', '--execute']))).not.toThrow();
  });

  it('only targets the v1 prefix for deletion mode', () => {
    expect(TTS_CACHE_KEY_PREFIX_V1).toBe('gloaming:tts:v1:');
    expect('gloaming:tts:v1:abc'.startsWith(TTS_CACHE_KEY_PREFIX_V1)).toBe(true);
    expect('gloaming:tts:v2:abc'.startsWith(TTS_CACHE_KEY_PREFIX_V1)).toBe(false);
    expect('bull:gloaming:queue'.startsWith(TTS_CACHE_KEY_PREFIX_V1)).toBe(false);
  });
});
