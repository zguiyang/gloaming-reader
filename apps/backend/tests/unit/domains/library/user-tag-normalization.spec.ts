import { describe, expect, it } from 'vitest';

import { normalizeTagName } from '@/domains/library/tags/normalization';

describe('User Tag name normalization', () => {
  it('keeps the existing per-user uniqueness normalization', () => {
    expect(normalizeTagName(' English ')).toBe('english');
    expect(normalizeTagName('Science Fiction')).toBe('sciencefiction');
    expect(normalizeTagName('中文 标签')).toBe('中文 标签');
  });
});
