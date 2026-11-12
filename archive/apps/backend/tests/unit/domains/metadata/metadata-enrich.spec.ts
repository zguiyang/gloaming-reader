import { describe, expect, it } from 'vitest';

import { computeMetadataEnrichGaps, selectFieldsNeedingAi } from '@/domains/metadata/enrich/candidate-selection';
import { buildEnrichMessages } from '@/domains/metadata/enrich/prompt';
import { EXCERPT_MAX_CHARS, TOC_TITLE_MAX } from '@/domains/metadata/enrich/prompt';
import { isShouty, isWeakDescription } from '@/domains/metadata/enrich/quality';
import { buildMetadataOutputSchema } from '@/domains/metadata/enrich/registry';

describe('metadata-enrich description quality', () => {
  it('treats short, generic and shouty descriptions as weak', () => {
    expect(isWeakDescription('')).toBe(true);
    expect(isWeakDescription('A book.')).toBe(true);
    expect(isWeakDescription('THE STORY OF THE GREAT BOOK')).toBe(true);
    expect(isWeakDescription('this book')).toBe(true);
    expect(
      isWeakDescription('A properly long description that actually says something useful about the story content.'),
    ).toBe(false);
    expect(isShouty('THE WOLF IN SHEEP')).toBe(true);
    expect(isShouty('The Wolf in Sheep')).toBe(false);
  });

  it('selects only description when it is weak', () => {
    expect([...selectFieldsNeedingAi('')]).toEqual(['description']);
    expect(
      computeMetadataEnrichGaps(
        'A properly long description that actually says something useful about the story content.',
      ),
    ).toEqual([]);
  });

  it('builds an output schema with only the required description field', () => {
    const schema = buildMetadataOutputSchema(['description']);
    expect(Object.keys(schema.shape)).toEqual(['description']);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ description: 'A factual description.' }).success).toBe(true);
    expect(buildMetadataOutputSchema([]).safeParse({}).success).toBe(true);
  });
});

describe('metadata-enrich prompt', () => {
  it('uses only current book context and asks for a single description field', () => {
    const messages = buildEnrichMessages({
      title: 'The Great Book',
      author: 'Jane Author',
      language: 'en',
      description: '',
      excerpt: 'Chapter one begins…',
      tocTitles: ['Chapter 1'],
    });
    const system = messages.find((message) => message.role === 'system')!.content;
    const user = messages.find((message) => message.role === 'user')!.content;
    expect(system).toContain('one string field named description');
    expect(user).toContain('The Great Book');
    expect(user).toContain('Jane Author');
    expect(user).toContain('Chapter one begins');
    expect(system).not.toMatch(/tag|categor|source/i);
  });

  it('caps the excerpt and TOC titles', () => {
    const messages = buildEnrichMessages({
      title: 'T',
      author: '',
      language: 'en',
      description: '',
      excerpt: 'x'.repeat(6000),
      tocTitles: Array.from({ length: 30 }, (_, index) => `Chapter ${index + 1}`),
    });
    const user = messages.find((message) => message.role === 'user')!.content;
    expect(user).toContain('x'.repeat(EXCERPT_MAX_CHARS));
    expect(user).not.toContain('x'.repeat(EXCERPT_MAX_CHARS + 1));
    expect(user).toContain(`Chapter ${TOC_TITLE_MAX}`);
    expect(user).not.toContain(`Chapter ${TOC_TITLE_MAX + 1}`);
  });
});
