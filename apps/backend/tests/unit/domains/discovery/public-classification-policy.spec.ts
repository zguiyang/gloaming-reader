import { describe, expect, it } from 'vitest';

import type { PublicCategory } from '@gloaming/shared/discovery';

import {
  PUBLIC_CLASSIFICATION_DAILY_RESERVATION_LIMIT,
  type PublicClassificationDecision,
  publicClassificationDecisionSchema,
} from '@/domains/discovery/categories/classification-contract';
import {
  buildPublicCategoryTranslationMessages,
  buildPublicClassificationMessages,
  estimatePublicClassificationInputTokens,
  PUBLIC_CLASSIFICATION_SYSTEM_PROMPT,
  publicClassificationInputWithinLimit,
} from '@/domains/discovery/categories/classification-prompt';
import {
  collectExistingCategoryNames,
  matchesLocaleScript,
  validatePublicCategoryTranslations,
  validatePublicClassificationDecision,
} from '@/domains/discovery/categories/classification-validation';
import { buildPublicCategory } from '@/domains/discovery/categories/policy';

function candidate(id: string, names: Record<string, string>, aliases: Array<{ locale: string; alias: string }> = []) {
  return buildPublicCategory({
    id,
    createdBy: 'manual',
    sourceLocale: 'en-US',
    meaning: `${id} meaning`,
    labels: Object.entries(names).map(([locale, name]) => ({ locale, name, editedBy: 'manual' as const })),
    aliases: aliases.map((alias) => ({ ...alias, editedBy: 'manual' as const })),
  });
}

const scienceFiction = candidate('cat-scifi', { 'en-US': 'Science Fiction', 'zh-CN': '科幻小说' }, [
  { locale: 'en-US', alias: 'Sci-Fi' },
]);
const adventure = candidate('cat-adventure', { 'en-US': 'Adventure', 'zh-CN': '冒险' });
const history = candidate('cat-history', { 'en-US': 'History', 'zh-CN': '历史' });

function decision(overrides: Partial<PublicClassificationDecision>): PublicClassificationDecision {
  return { outcome: 'NO_MATCH', reuse: [], create: [], reviewReason: null, ...overrides };
}

describe('public classification decision schema', () => {
  it('accepts each of the four allowed outcomes', () => {
    expect(
      publicClassificationDecisionSchema.safeParse(
        decision({ outcome: 'REUSE', reuse: [{ categoryId: 'cat-scifi', rationale: 'same concept' }] }),
      ).success,
    ).toBe(true);
    expect(
      publicClassificationDecisionSchema.safeParse(
        decision({
          outcome: 'CREATE',
          create: [
            {
              name: 'Space Opera',
              meaning: 'Space-set speculative fiction',
              reusable: true,
              distinctFromExisting: true,
              rationale: 'broad',
            },
          ],
        }),
      ).success,
    ).toBe(true);
    expect(publicClassificationDecisionSchema.safeParse(decision({ outcome: 'NO_MATCH' })).success).toBe(true);
    expect(
      publicClassificationDecisionSchema.safeParse(
        decision({ outcome: 'NEEDS_REVIEW', reviewReason: 'conflicting subjects' }),
      ).success,
    ).toBe(true);
  });

  it('rejects contradictory or oversized decisions', () => {
    const tooMany = decision({
      outcome: 'REUSE',
      reuse: [
        { categoryId: 'a', rationale: 'r' },
        { categoryId: 'b', rationale: 'r' },
        { categoryId: 'c', rationale: 'r' },
        { categoryId: 'd', rationale: 'r' },
      ],
    });
    expect(publicClassificationDecisionSchema.safeParse(tooMany).success).toBe(false);

    expect(
      publicClassificationDecisionSchema.safeParse(
        decision({ outcome: 'NO_MATCH', reuse: [{ categoryId: 'a', rationale: 'r' }] }),
      ).success,
    ).toBe(false);
    expect(
      publicClassificationDecisionSchema.safeParse(
        decision({
          outcome: 'REUSE',
          reuse: [],
          create: [{ name: 'X', meaning: 'x', reusable: true, distinctFromExisting: true, rationale: 'r' }],
        }),
      ).success,
    ).toBe(false);
    expect(publicClassificationDecisionSchema.safeParse(decision({ outcome: 'CREATE' })).success).toBe(false);
    expect(publicClassificationDecisionSchema.safeParse(decision({ outcome: 'NEEDS_REVIEW' })).success).toBe(false);
  });

  it('rejects a create that does not assert reuse value and distinctness', () => {
    const result = publicClassificationDecisionSchema.safeParse({
      outcome: 'CREATE',
      reuse: [],
      create: [{ name: 'X', meaning: 'x', reusable: false, distinctFromExisting: true, rationale: 'r' }],
      reviewReason: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('public classification validator', () => {
  const candidates = [scienceFiction, adventure, history];

  it('keeps only supplied reuse ids and deduplicates them', () => {
    const validated = validatePublicClassificationDecision(
      decision({
        outcome: 'REUSE',
        reuse: [
          { categoryId: 'cat-scifi', rationale: 'r' },
          { categoryId: 'user-tag-1', rationale: 'r' },
          { categoryId: 'cat-scifi', rationale: 'r' },
          { categoryId: 'cat-adventure', rationale: 'r' },
        ],
      }),
      candidates,
      'en-US',
    );
    expect(validated.outcome).toBe('REUSE');
    expect(validated.reuse.map((item) => item.categoryId)).toEqual(['cat-scifi', 'cat-adventure']);
    expect(validated.create).toEqual([]);
  });

  it('drops unsafe, wrong-script, and duplicate new names, and converts an existing-name collision to reuse', () => {
    const validated = validatePublicClassificationDecision(
      decision({
        outcome: 'CREATE',
        create: [
          { name: 'Sci-Fi', meaning: 'alias collision', reusable: true, distinctFromExisting: true, rationale: 'r' },
          {
            name: '科幻小说',
            meaning: 'wrong script for en-US',
            reusable: true,
            distinctFromExisting: true,
            rationale: 'r',
          },
          { name: 'Bad\u202eName', meaning: 'unsafe', reusable: true, distinctFromExisting: true, rationale: 'r' },
          { name: 'Space Opera', meaning: 'first valid', reusable: true, distinctFromExisting: true, rationale: 'r' },
          {
            name: 'space   opera',
            meaning: 'duplicate of new',
            reusable: true,
            distinctFromExisting: true,
            rationale: 'r',
          },
        ],
      }),
      candidates,
      'en-US',
    );
    expect(validated.outcome).toBe('CREATE');
    expect(validated.reuse.map((item) => item.categoryId)).toEqual(['cat-scifi']);
    expect(validated.create.map((item) => item.name)).toEqual(['Space Opera']);
  });

  it('reuses the existing stable id for an exact normalized name collision instead of creating', () => {
    const validated = validatePublicClassificationDecision(
      decision({
        outcome: 'CREATE',
        create: [
          {
            name: '  science   fiction ',
            meaning: 'exact collision',
            reusable: true,
            distinctFromExisting: true,
            rationale: 'r',
          },
        ],
      }),
      candidates,
      'en-US',
    );
    expect(validated).toEqual({
      outcome: 'REUSE',
      reuse: [{ categoryId: 'cat-scifi', rationale: 'r' }],
      create: [],
    });
  });

  it('does not treat an identical label in another locale as the same category', () => {
    const translatedLabelOnly = candidate('cat-zh-only', { 'zh-CN': 'AI' });
    const validated = validatePublicClassificationDecision(
      decision({
        outcome: 'CREATE',
        create: [
          {
            name: 'AI',
            meaning: 'artificial intelligence',
            reusable: true,
            distinctFromExisting: true,
            rationale: 'same spelling in another locale does not establish identity',
          },
        ],
      }),
      [...candidates, translatedLabelOnly],
      'en-US',
    );

    expect(validated.outcome).toBe('CREATE');
    expect(validated.reuse).toEqual([]);
    expect(validated.create.map((item) => item.name)).toEqual(['AI']);
  });

  it('clamps the total to three with reuses first and downgrades an unsupported outcome', () => {
    const clamped = validatePublicClassificationDecision(
      decision({
        outcome: 'CREATE',
        reuse: [
          { categoryId: 'cat-scifi', rationale: 'r' },
          { categoryId: 'cat-adventure', rationale: 'r' },
          { categoryId: 'cat-history', rationale: 'r' },
        ],
        create: [{ name: 'Space Opera', meaning: 'broad', reusable: true, distinctFromExisting: true, rationale: 'r' }],
      }),
      candidates,
      'en-US',
    );
    expect(clamped.outcome).toBe('REUSE');
    expect(clamped.reuse).toHaveLength(3);
    expect(clamped.create).toHaveLength(0);

    const downgraded = validatePublicClassificationDecision(
      decision({ outcome: 'REUSE', reuse: [{ categoryId: 'missing', rationale: 'r' }] }),
      candidates,
      'en-US',
    );
    expect(downgraded).toEqual({ outcome: 'NO_MATCH', reuse: [], create: [] });
  });

  it('never selects anything for NO_MATCH or NEEDS_REVIEW', () => {
    expect(
      validatePublicClassificationDecision(
        decision({ outcome: 'NEEDS_REVIEW', reviewReason: 'ambiguous' }),
        candidates,
        'en-US',
      ),
    ).toEqual({ outcome: 'NEEDS_REVIEW', reuse: [], create: [] });
  });

  it('collects existing names across locales and aliases, and checks scripts', () => {
    const names = collectExistingCategoryNames(candidates);
    expect(names.has('science fiction')).toBe(true);
    expect(names.has('sci-fi')).toBe(true);
    expect(names.has('科幻小说')).toBe(true);
    expect(matchesLocaleScript('科幻', 'zh-CN')).toBe(true);
    expect(matchesLocaleScript('Science Fiction', 'zh-CN')).toBe(false);
    expect(matchesLocaleScript('Science Fiction', 'en-US')).toBe(true);
  });
});

describe('public category translation validator', () => {
  it('keeps only requested locales with safe, non-colliding names', () => {
    const taken = new Map<string, Set<string>>([['zh-CN', new Set(['科幻小说'])]]);
    const validated = validatePublicCategoryTranslations(
      {
        translations: [
          { locale: 'zh-CN', name: '科幻' },
          { locale: 'zh-CN', name: '科幻小说' },
          { locale: 'en-US', name: 'Science Fiction' },
          { locale: 'fr-FR' as never, name: 'Science-fiction' },
        ],
      },
      ['zh-CN'],
      taken,
    );
    // zh-CN collision with another category is dropped; en-US is not a requested locale.
    expect(validated).toEqual([{ locale: 'zh-CN', name: '科幻' }]);
  });

  it('drops unsafe and script-mismatched translations', () => {
    const validated = validatePublicCategoryTranslations(
      {
        translations: [
          { locale: 'zh-CN', name: 'Science Fiction' },
          { locale: 'en-US', name: 'Bad\u2066Name' },
        ],
      },
      ['zh-CN', 'en-US'],
      new Map(),
    );
    expect(validated).toEqual([]);
  });
});

describe('public classification prompt', () => {
  const record = {
    id: 'rec-1',
    title: 'A very long title '.repeat(40),
    authors: ['Author One'],
    languages: ['en-US'],
    description: 'd'.repeat(2_000),
    subjects: ['Subject One', 'Subject Two'],
    bookshelves: ['Shelf One'],
  };

  it('bounds record evidence and exposes only public category retrieval fields', () => {
    const messages = buildPublicClassificationMessages(record, [scienceFiction], 'en-US');
    const user = JSON.parse(messages.find((message) => message.role === 'user')!.content) as {
      sourceLocale: string;
      sourceRecord: { title: string; description: string; subjects: string[] };
      publicCategories: Array<Record<string, unknown>>;
    };
    expect(user.sourceLocale).toBe('en-US');
    expect(user.sourceRecord.title.length).toBe(240);
    expect(user.sourceRecord.description.length).toBe(1_000);
    expect(user.sourceRecord.subjects).toEqual(['Subject One', 'Subject Two']);
    const category = user.publicCategories[0]!;
    expect(Object.keys(category).sort()).toEqual(['aliases', 'id', 'meaning', 'names']);
    expect(category.id).toBe('cat-scifi');
    expect(JSON.stringify(user)).not.toContain('userTag');
  });

  it('encodes the shared decision flow and keep-in-bounds budget', () => {
    expect(PUBLIC_CLASSIFICATION_SYSTEM_PROMPT).toContain('Decision A');
    expect(PUBLIC_CLASSIFICATION_SYSTEM_PROMPT).toContain('Decision B');
    expect(PUBLIC_CLASSIFICATION_SYSTEM_PROMPT).toContain('at most three');
    expect(PUBLIC_CLASSIFICATION_SYSTEM_PROMPT).toContain('Never merge, rename, delete');
    expect(PUBLIC_CLASSIFICATION_SYSTEM_PROMPT).not.toContain('User Tags');
    expect(estimatePublicClassificationInputTokens('abcd')).toBe(1);
    expect(publicClassificationInputWithinLimit('x'.repeat(1_000))).toBe(true);
    expect(publicClassificationInputWithinLimit('汉'.repeat(4_000))).toBe(false);
    expect(PUBLIC_CLASSIFICATION_DAILY_RESERVATION_LIMIT).toBe(50);
  });

  it('builds a translation prompt limited to requested locales', () => {
    const messages = buildPublicCategoryTranslationMessages({
      categoryId: 'cat-scifi',
      meaning: 'Speculative fiction',
      existingLabels: { 'en-US': 'Science Fiction' },
      aliases: [{ locale: 'en-US', alias: 'Sci-Fi' }],
      targetLocales: ['zh-CN'],
    });
    const user = JSON.parse(messages.find((message) => message.role === 'user')!.content) as {
      targetLocales: string[];
    };
    expect(user.targetLocales).toEqual(['zh-CN']);
  });
});

describe('public category candidate typing', () => {
  it('treats a public category as the candidate shape', () => {
    const typed: PublicCategory = scienceFiction;
    expect(typed.manualLocales).toEqual(['en-US', 'zh-CN']);
  });
});
