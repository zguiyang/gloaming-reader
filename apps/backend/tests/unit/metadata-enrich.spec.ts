import { describe, expect, it } from 'vitest';

import { buildEnrichMessages } from '@/modules/metadata-enrich/prompt';
import { isShouty, isStopwordTag, isWeakDescription } from '@/modules/metadata-enrich/quality';
import {
  buildMetadataOutputSchema,
  cleanCategoryRef,
  cleanTagRefs,
  localizedNameEntrySchema,
} from '@/modules/metadata-enrich/registry';
import { areWorkTagsWeak, isCategoryWeak } from '@/modules/metadata-enrich/taxonomy-localized';

describe('metadata-enrich quality heuristics', () => {
  it('treats short, generic and shouty descriptions as weak', () => {
    expect(isWeakDescription('')).toBe(true);
    expect(isWeakDescription('A book.')).toBe(true);
    expect(isWeakDescription('THE STORY OF THE GREAT BOOK')).toBe(true);
    expect(isWeakDescription('this book')).toBe(true);
    expect(
      isWeakDescription('A properly long description that actually says something useful about the story content.'),
    ).toBe(false);
  });

  it('filters stopword tags', () => {
    expect(isStopwordTag('Book')).toBe(true);
    expect(isStopwordTag('novel')).toBe(true);
    expect(isStopwordTag('Science Fiction')).toBe(false);
  });

  it('detects shouty text', () => {
    expect(isShouty('THE WOLF IN SHEEP')).toBe(true);
    expect(isShouty('The Wolf in Sheep')).toBe(false);
  });

  it('mentions LCSH prohibition and passes catalog subject hints', () => {
    const messages = buildEnrichMessages({
      title: 'T',
      author: '',
      language: 'en',
      existingTags: [],
      catalogSubjects: ['Fables, Greek -- Translations into English'],
      ruleTagCandidates: ['Fables', 'Greek'],
      ruleDescription: '',
      excerpt: 'x'.repeat(200),
      tocTitles: [],
      requiredFields: ['tags'],
    });
    const system = messages.find((m) => m.role === 'system')!.content;
    const user = messages.find((m) => m.role === 'user')!.content;
    expect(system).toContain('LCSH');
    expect(user).toContain('Ebook catalog subjects');
    expect(user).toContain('Fables, Greek -- Translations into English');
    expect(user).toContain('Rule-derived tag candidates');
  });
});

describe('metadata-enrich prompt (single-book context only)', () => {
  it('contains only the current book and never global catalog data', () => {
    const messages = buildEnrichMessages({
      title: 'The Great Book',
      author: 'Jane Author',
      language: 'en',
      existingTags: ['Science'],
      ruleDescription: '',
      excerpt: 'Chapter one begins…',
      tocTitles: ['Chapter 1', 'Chapter 2'],
      requiredFields: ['description', 'tags', 'category'],
    });

    const system = messages.find((m) => m.role === 'system')!.content;
    const user = messages.find((m) => m.role === 'user')!.content;

    expect(user).toContain('The Great Book');
    expect(user).toContain('Jane Author');
    expect(user).toContain('Chapter one begins');
    expect(system).toContain('list_existing_tags');
    expect(system).toContain('list_categories');
    expect(system).not.toContain('Science Fiction'); // global tag list must not leak
    expect(user).not.toContain('Mystery');
    expect(user).not.toContain('Thriller');
  });

  it('declares required and complete fields so the model fills exactly the gaps', () => {
    const messages = buildEnrichMessages({
      title: 'T',
      author: '',
      language: 'en',
      existingTags: [],
      ruleDescription: '',
      excerpt: 'x'.repeat(200),
      tocTitles: [],
      requiredFields: ['category'],
    });

    const system = messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('Required fields to fill: category.');
    expect(system).toContain('Already complete, do not output: description, tags.');
    expect(system).toContain('id');
    expect(system).toContain('null');
  });

  it('caps the excerpt and TOC titles', () => {
    const messages = buildEnrichMessages({
      title: 'T',
      author: '',
      language: 'en',
      existingTags: [],
      ruleDescription: '',
      excerpt: 'x'.repeat(6000),
      tocTitles: Array.from({ length: 30 }, (_, i) => `Chapter ${i + 1}`),
      requiredFields: ['description'],
    });
    const user = messages.find((m) => m.role === 'user')!.content;
    expect(user.length).toBeLessThan(6000);
    const tocLine = user.split('\n').find((line) => line.startsWith('Chapter 1'));
    expect(tocLine).toBe('Chapter 1');
    expect(user).not.toContain('Chapter 16');
  });
  it('mentions reuse-or-create for both tags and category', () => {
    const messages = buildEnrichMessages({
      title: 'T',
      author: '',
      language: 'en',
      existingTags: [],
      ruleDescription: '',
      excerpt: 'x'.repeat(200),
      tocTitles: [],
      requiredFields: ['tags', 'category'],
    });
    const system = messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('list_existing_tags');
    expect(system).toContain('list_categories');
    expect(system).toContain('id');
    expect(system).toContain('null');
    expect(system).toMatch(/reuse|create|list_categories/i);
  });

  it('requires localized taxonomy names for supported locales and keeps description in book language', () => {
    const messages = buildEnrichMessages({
      title: 'T',
      author: '',
      language: 'en',
      existingTags: [],
      ruleDescription: '',
      excerpt: 'x'.repeat(200),
      tocTitles: [],
      requiredFields: ['tags', 'category'],
    });
    const system = messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('zh-CN, en-US');
    expect(system).toContain('localizedNames');
    expect(system).toContain('do not localize the description');
  });
});

const fablesLocalized = [
  { locale: 'zh-CN' as const, name: '寓言' },
  { locale: 'en-US' as const, name: 'Fables' },
];
const moralityLocalized = [
  { locale: 'zh-CN' as const, name: '道德' },
  { locale: 'en-US' as const, name: 'Morality' },
];

describe('metadata-enrich taxonomy refs and dynamic schema', () => {
  it('builds an output schema containing only the required fields, all required', () => {
    const schema = buildMetadataOutputSchema(['category']);
    const shape = schema.shape as Record<string, unknown>;
    expect(Object.keys(shape)).toEqual(['category']);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ category: { id: null, name: 'Fables', localizedNames: fablesLocalized } }).success).toBe(
      true,
    );
    expect(schema.safeParse({ category: null }).success).toBe(false);

    const full = buildMetadataOutputSchema(['description', 'tags', 'category']);
    expect(Object.keys(full.shape as Record<string, unknown>).sort()).toEqual(['category', 'description', 'tags']);
    expect(full.safeParse({ description: 'd', tags: [], category: null }).success).toBe(false);
    expect(
      full.safeParse({
        description: 'd',
        tags: Array.from({ length: 4 }, (_, index) => ({
          id: null,
          name: `Tag ${index + 1}`,
          localizedNames: fablesLocalized,
        })),
        category: { id: null, name: 'Fiction', localizedNames: fablesLocalized },
      }).success,
    ).toBe(false);
    expect(
      full.safeParse({
        description: 'd',
        tags: [{ id: null, name: 'Adventure', localizedNames: fablesLocalized }],
        category: { id: null, name: 'Fiction', localizedNames: fablesLocalized },
      }).success,
    ).toBe(true);
    expect(full.safeParse({ description: 'd' }).success).toBe(false);
  });

  it('localizedNameEntrySchema accepts only supported locales', () => {
    expect(localizedNameEntrySchema.safeParse({ locale: 'zh-CN', name: '科学' }).success).toBe(true);
    expect(localizedNameEntrySchema.safeParse({ locale: 'fr-FR', name: 'Science' }).success).toBe(false);
  });

  it('cleanTagRefs keeps reuse ids, localized names, and drops junk', () => {
    expect(
      cleanTagRefs([
        { id: 'tag-1', name: 'Fables', localizedNames: fablesLocalized },
        { id: null, name: 'Morality', localizedNames: moralityLocalized },
        { id: 'tag-2', name: ' ' },
        'not-an-object',
      ]),
    ).toEqual([
      {
        name: 'Fables',
        existingId: 'tag-1',
        localizedNames: { 'zh-CN': '寓言', 'en-US': 'Fables' },
      },
      {
        name: 'Morality',
        localizedNames: { 'zh-CN': '道德', 'en-US': 'Morality' },
      },
    ]);
  });

  it('cleanTagRefs assigns ref.name to a single inferred locale when entries are missing', () => {
    expect(cleanTagRefs([{ id: null, name: 'Science' }])).toEqual([
      {
        name: 'Science',
        localizedNames: { 'en-US': 'Science' },
      },
    ]);
    expect(cleanTagRefs([{ id: null, name: '寓言' }])).toEqual([
      {
        name: '寓言',
        localizedNames: { 'zh-CN': '寓言' },
      },
    ]);
  });

  it('cleanCategoryRef returns undefined for null/empty', () => {
    expect(cleanCategoryRef(null)).toBeUndefined();
    const classicLocalized = [
      { locale: 'zh-CN' as const, name: '经典' },
      { locale: 'en-US' as const, name: 'Classic' },
    ];
    expect(cleanCategoryRef({ id: 'cat-1', name: 'Classic', localizedNames: classicLocalized })).toEqual({
      name: 'Classic',
      existingId: 'cat-1',
      localizedNames: { 'zh-CN': '经典', 'en-US': 'Classic' },
    });
    expect(cleanCategoryRef({ id: null, name: '  ' })).toBeUndefined();
    expect(cleanCategoryRef('Children Fiction')).toEqual({
      name: 'Children Fiction',
      localizedNames: { 'en-US': 'Children Fiction' },
    });
  });

  it('treats English-only tags as weak for localization backfill', () => {
    expect(areWorkTagsWeak([{ name: 'Science', localizedNames: {} }])).toBe(true);
    expect(
      areWorkTagsWeak([
        {
          name: 'Science',
          localizedNames: { 'en-US': 'Science', 'zh-CN': '科学' },
        },
      ]),
    ).toBe(false);
  });

  it('treats categories missing locale translations as weak', () => {
    expect(isCategoryWeak({ name: 'Fiction', localizedNames: { 'en-US': 'Fiction' } })).toBe(true);
    expect(
      isCategoryWeak({
        name: 'Fiction',
        localizedNames: { 'en-US': 'Fiction', 'zh-CN': '小说' },
      }),
    ).toBe(false);
  });
});
