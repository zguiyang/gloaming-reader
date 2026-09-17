import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { commonEnv } from '@/lib/env-common';

const CIPHER_PREFIX = 'v1:';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function encryptionKeyBytes(): Buffer {
  const raw = commonEnv.LLM_CONFIG_ENCRYPTION_KEY.trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const fromBase64 = Buffer.from(raw, 'base64');
  if (fromBase64.length === 32) {
    return fromBase64;
  }
  // Deterministic 32-byte material when operators paste a passphrase-length secret in local/dev.
  return createHash('sha256').update(raw, 'utf8').digest();
}

/** Encrypt an API key for DB storage (`v1:` + base64(iv|tag|ciphertext)). */
export function encryptApiKey(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', encryptionKeyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CIPHER_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

/** Decrypt a ciphertext produced by `encryptApiKey`. */
export function decryptApiKey(ciphertext: string): string {
  if (!ciphertext.startsWith(CIPHER_PREFIX)) {
    throw new Error('Unsupported LLM API key ciphertext version');
  }
  const packed = Buffer.from(ciphertext.slice(CIPHER_PREFIX.length), 'base64');
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Invalid LLM API key ciphertext');
  }
  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const data = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKeyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Mask for Admin APIs — never returns the full secret. */
export function maskApiKey(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 4) {
    return '****';
  }
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}
