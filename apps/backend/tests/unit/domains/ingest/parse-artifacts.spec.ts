import { describe, expect, it } from 'vitest';

import { coverKey, imageKey, sha256, storageExtensionForMime } from '@/domains/ingest/parser/parse-artifacts';

describe('storageExtensionForMime', () => {
  it('maps final MIME types to safe extensions without defaulting unknowns to jpg', () => {
    expect(storageExtensionForMime('image/jpeg')).toBe('jpg');
    expect(storageExtensionForMime('image/jpg')).toBe('jpg');
    expect(storageExtensionForMime('image/png')).toBe('png');
    expect(storageExtensionForMime('image/gif')).toBe('gif');
    expect(storageExtensionForMime('image/webp')).toBe('webp');
    expect(storageExtensionForMime('image/svg+xml')).toBe('svg');
    expect(storageExtensionForMime('application/octet-stream')).toBe('bin');
  });
});

describe('imageKey', () => {
  it('embeds img-v1, attempt token, source hash, and extension from final MIME', () => {
    const sourceHash = 'a'.repeat(64);
    expect(imageKey('work-1', 'attempt-1', sourceHash, 'image/webp')).toBe(
      `book-images/work-1/attempt-1/img-v1/${sourceHash}.webp`,
    );
    expect(imageKey('work-1', 'attempt-1', sourceHash, 'image/png')).toBe(
      `book-images/work-1/attempt-1/img-v1/${sourceHash}.png`,
    );
  });
});

describe('coverKey', () => {
  it('embeds img-v1, source hash, and SVG extension without jpg masquerade', () => {
    const sourceHash = sha256(Buffer.from('cover-bytes'));
    expect(coverKey('work-2', 'tok-b', sourceHash, 'image/svg+xml')).toBe(
      `covers/work-2/tok-b/img-v1/${sourceHash}.svg`,
    );
    expect(coverKey('work-2', 'tok-b', sourceHash, 'image/unknown')).toBe(
      `covers/work-2/tok-b/img-v1/${sourceHash}.bin`,
    );
  });
});
