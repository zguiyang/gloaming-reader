import { describe, expect, it } from 'vitest';

import { decryptApiKey, encryptApiKey, maskApiKey } from '@/lib/llm/crypto';

describe('llm crypto', () => {
  it('round-trips API key encryption', () => {
    const plaintext = 'sk-test-secret-value-123456';
    const ciphertext = encryptApiKey(plaintext);
    expect(ciphertext.startsWith('v1:')).toBe(true);
    expect(decryptApiKey(ciphertext)).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext', () => {
    const plaintext = 'sk-same';
    expect(encryptApiKey(plaintext)).not.toBe(encryptApiKey(plaintext));
  });

  it('masks keys without exposing the middle', () => {
    expect(maskApiKey('sk-abcdefghijklmnop')).toBe('sk-…mnop');
    expect(maskApiKey('ab')).toBe('****');
  });
});
