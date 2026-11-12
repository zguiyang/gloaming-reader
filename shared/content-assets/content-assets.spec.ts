import { describe, expect, it } from 'vitest';

import { contentAssetMetaSchema } from './content-assets.ts';

describe('contentAssetMetaSchema', () => {
  it('accepts image/cover/origin metadata', () => {
    const parsed = contentAssetMetaSchema.parse({
      objectKeys: ['book-images/p1/a.webp'],
      originalFileName: 'chapter1.html',
      size: 1234,
      originalPath: 'OEBPS/chapter1.html',
      reused: true,
    });
    expect(parsed.objectKeys).toEqual(['book-images/p1/a.webp']);
    expect(parsed.originalFileName).toBe('chapter1.html');
    expect(parsed.size).toBe(1234);
    expect(parsed.originalPath).toBe('OEBPS/chapter1.html');
    expect(parsed.reused).toBe(true);
  });

  it('does not fail whole-asset parsing when historical metadata includes legacy fields', () => {
    const parsed = contentAssetMetaSchema.parse({
      objectKeys: ['book-images/p1/a.webp'],
      // Legacy whole-chapter audio keys may still appear on old rows; they pass
      // through so the schema stays tolerant of historical metadata.
      voice: 'en-US-JennyNeural',
      durationMs: 900,
      legacySegmentCount: 1,
      unknownOpsFlag: true,
    });
    expect(parsed).toMatchObject({ legacySegmentCount: 1, unknownOpsFlag: true });
  });
});
