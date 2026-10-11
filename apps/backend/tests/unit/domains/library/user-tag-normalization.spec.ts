import { describe, expect, it } from 'vitest';

import { normalizeTagName } from '@/domains/library/tags/normalization';

describe('User Tag name normalization', () => {
  it('normalizes Unicode text while retaining meaningful punctuation', () => {
    expect(normalizeTagName(' English ')).toBe('english');
    expect(normalizeTagName('Science   Fiction')).toBe('science fiction');
    expect(normalizeTagName('英语学习2')).not.toBe(normalizeTagName('儿童文学2'));
    expect(normalizeTagName('C++')).not.toBe(normalizeTagName('C#'));
    expect(normalizeTagName('.NET')).toBe('.net');
    expect(normalizeTagName('AI/ML')).not.toBe(normalizeTagName('AI ML'));
    expect(normalizeTagName('React学习')).toBe('react学习');
    expect(normalizeTagName('İ')).toBe('i\u0307');
    expect(normalizeTagName('I')).toBe('i');
    expect(normalizeTagName('ΟΣ')).toBe('ος');
    expect(normalizeTagName('A\u00a0B')).toBe('a b');
    expect(normalizeTagName('A\ufeffB')).toBe('a b');
  });

  it('normalizes canonically equivalent Unicode spellings to one key', () => {
    expect(normalizeTagName('café')).toBe(normalizeTagName('cafe\u0301'));
  });
});
