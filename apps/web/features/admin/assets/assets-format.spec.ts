import { describe, expect, it } from 'vitest';

import { buildCategoryChartData, formatStorageBytes, shortObjectKey } from './assets-format.ts';

describe('formatStorageBytes', () => {
  it('formats common sizes', () => {
    expect(formatStorageBytes(0)).toBe('0 B');
    expect(formatStorageBytes(512)).toBe('512 B');
    expect(formatStorageBytes(1024)).toBe('1.00 KB');
    expect(formatStorageBytes(964984832)).toBe('920.3 MB');
  });
});

describe('shortObjectKey', () => {
  it('keeps short keys and truncates long paths', () => {
    expect(shortObjectKey('epub/a.epub')).toBe('epub/a.epub');
    expect(shortObjectKey('part-audio/p1/audio_us/h/chapter.mp3')).toBe('…/h/chapter.mp3');
  });
});

describe('buildCategoryChartData', () => {
  it('drops zero-byte categories and assigns chart colors', () => {
    const data = buildCategoryChartData([
      { category: 'audio', objectCount: 2, bytes: 100 },
      { category: 'cover', objectCount: 0, bytes: 0 },
      { category: 'origin', objectCount: 1, bytes: 50 },
    ]);
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ category: 'audio', label: '音频', fill: 'var(--chart-1)' });
    expect(data[1]).toMatchObject({ category: 'origin', label: '原始文件' });
  });
});
