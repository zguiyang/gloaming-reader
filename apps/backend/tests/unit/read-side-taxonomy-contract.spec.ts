import { describe, expect, it } from 'vitest';

import { readerPartDataSchema, readerPartsDataSchema } from '@gloaming/shared/reader';
import { shelfDataSchema } from '@gloaming/shared/shelf';
import { workSchema } from '@gloaming/shared/works';

const taxonomyTag = {
  id: 'tag-science',
  names: { 'zh-CN': '科学', 'en-US': 'Science' },
  origin: 'manual' as const,
};

const taxonomySource = {
  id: 'source-gutenberg',
  names: { 'en-US': 'Project Gutenberg' },
  origin: 'extracted' as const,
  matchRule: 'gutenberg.org',
};

describe('read-side taxonomy response contracts', () => {
  it('accepts reader work summaries with taxonomy tag references', () => {
    const payload = readerPartsDataSchema.parse({
      work: {
        id: 'work-1',
        title: 'Ocean Quiet',
        description: 'A calm read.',
        tags: [taxonomyTag],
        coverAssetId: null,
        publishedAt: '2026-08-21T00:00:00.000Z',
      },
      parts: [],
    });
    expect(payload.work.tags[0]?.id).toBe('tag-science');
  });

  it('accepts reader part payloads with taxonomy tag references', () => {
    const payload = readerPartDataSchema.parse({
      work: {
        id: 'work-1',
        title: 'Ocean Quiet',
        coverAssetId: null,
        tags: [taxonomyTag],
      },
      part: {
        id: 'part-1',
        workId: 'work-1',
        sortOrder: 0,
        kind: 'chapter',
        title: 'Chapter 1',
        body: '<p>Hello</p>',
      },
      audioAvailable: { us: false, uk: false },
    });
    expect(payload.work.tags).toHaveLength(1);
  });

  it('accepts shelf payloads with taxonomy tag references', () => {
    const payload = shelfDataSchema.parse({
      current: {
        work: {
          id: 'work-1',
          title: 'Ocean Quiet',
          description: '',
          tags: [taxonomyTag],
          coverAssetId: null,
          publishedAt: '2026-08-21T00:00:00.000Z',
        },
        state: {
          status: 'in_progress',
          currentPartId: 'part-1',
          progressRatio: 40,
          completedThroughSortOrder: 0,
          totalPartCount: 3,
          lastReadAt: '2026-08-21T00:00:00.000Z',
          completedAt: null,
        },
      },
      items: [],
    });
    expect(payload.current?.work.tags[0]?.names['en-US']).toBe('Science');
  });

  it('accepts recommendation work items with taxonomy tags and sources', () => {
    const payload = workSchema.parse({
      id: 'work-1',
      title: 'Ocean Quiet',
      author: 'Author',
      description: 'Desc',
      language: 'en',
      status: 'published',
      visibility: 'catalog',
      originKind: 'admin_epub',
      tags: [taxonomyTag],
      sources: [taxonomySource],
      coverAssetId: null,
      wordCount: 1000,
      estimatedMinutes: 10,
      suggestedVocabSize: 2000,
      difficultyScore: 3,
      statsProvenance: 'algorithm',
      publishedAt: '2026-08-21T00:00:00.000Z',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
    });
    expect(payload.sources[0]?.matchRule).toBe('gutenberg.org');
  });
});
