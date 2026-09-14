import { describe, expect, it } from 'vitest';

import { readerWorkSummarySchema } from '@gloaming/shared/reader';
import { resolveLocalizedText } from '@gloaming/shared/taxonomy';

const bilingualTag = {
  id: 'tag-science',
  names: { 'zh-CN': '科学', 'en-US': 'Science' },
  origin: 'manual' as const,
};

const enOnlyTag = {
  id: 'tag-classic',
  names: { 'en-US': 'Classic' },
  origin: 'extracted' as const,
};

describe('shelf taxonomy display', () => {
  it('resolves bilingual tag labels per locale', () => {
    expect(resolveLocalizedText(bilingualTag.names, 'zh-CN')).toBe('科学');
    expect(resolveLocalizedText(bilingualTag.names, 'en-US')).toBe('Science');
  });

  it('falls back when the active locale is missing', () => {
    expect(resolveLocalizedText(enOnlyTag.names, 'zh-CN')).toBe('Classic');
  });

  it('rejects legacy string tags on shelf work summaries', () => {
    expect(() =>
      readerWorkSummarySchema.parse({
        id: 'work-1',
        title: 'Ocean Quiet',
        description: '',
        tags: ['Classic'],
        coverAssetId: null,
        publishedAt: '2026-08-21T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
