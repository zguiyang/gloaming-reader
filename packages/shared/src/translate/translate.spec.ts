import { describe, expect, it } from 'vitest';

import {
  bilingualCachePayloadSchema,
  translatePartBodySchema,
  translateSseDoneSchema,
  translateSseMetaSchema,
  translateSseSentenceSchema,
  translateSseTitleSchema,
} from './translate.ts';

describe('translate part body', () => {
  it('accepts partId', () => {
    const parsed = translatePartBodySchema.parse({ partId: 'part_1' });
    expect(parsed.partId).toBe('part_1');
  });

  it('rejects empty partId', () => {
    const result = translatePartBodySchema.safeParse({ partId: '' });
    expect(result.success).toBe(false);
  });
});

describe('translate SSE payloads', () => {
  it('accepts meta with paragraph indices', () => {
    const parsed = translateSseMetaSchema.parse({
      contentHash: 'abc',
      titleEn: 'Hello',
      sentences: [{ index: 0, paragraphIndex: 0, en: 'Hello.' }],
    });
    expect(parsed.sentences[0]?.paragraphIndex).toBe(0);
  });

  it('accepts title and sentence events', () => {
    expect(translateSseTitleSchema.parse({ zh: '你好' }).zh).toBe('你好');
    expect(translateSseSentenceSchema.parse({ index: 0, zh: '你好。' }).index).toBe(0);
  });

  it('accepts done with cached flag', () => {
    const parsed = translateSseDoneSchema.parse({ contentHash: 'abc', cached: true });
    expect(parsed.cached).toBe(true);
  });

  it('accepts bilingual cache payload', () => {
    const parsed = bilingualCachePayloadSchema.parse({
      titleEn: 'Hello',
      titleZh: '你好',
      sentences: [{ index: 0, paragraphIndex: 0, en: 'Hello.', zh: '你好。' }],
    });
    expect(parsed.sentences).toHaveLength(1);
  });
});
