import { describe, expect, it } from 'vitest';

import { splitForTts } from '@/modules/content-assets/audio/part-audio-split';

describe('splitForTts', () => {
  it('returns a single segment for short text', () => {
    expect(splitForTts('Hello world.')).toEqual(['Hello world.']);
  });

  it('packs sentences under the character budget', () => {
    const sentence = 'Word '.repeat(20).trim() + '.';
    const text = Array.from({ length: 10 }, () => sentence).join(' ');
    const chunks = splitForTts(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toContain('Word');
  });

  it('returns empty for blank input', () => {
    expect(splitForTts('   ')).toEqual([]);
  });
});
