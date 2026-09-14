import { describe, expect, it } from 'vitest';

import { clampRecommendationLimit } from '@gloaming/shared/recommendations';

import {
  buildShelfProfile,
  extractCategoryId,
  extractTagIds,
  type RecommendationFeatures,
  resolveRecommendationOrder,
  scoreAgainstAnchor,
} from '@/modules/recommendations/score';

function feat(partial: Partial<RecommendationFeatures> & Pick<RecommendationFeatures, 'id'>): RecommendationFeatures {
  return {
    tagIds: [],
    categoryId: null,
    language: 'en',
    difficultyScore: null,
    suggestedVocabSize: null,
    estimatedMinutes: null,
    publishedAt: null,
    ...partial,
  };
}

describe('clampRecommendationLimit', () => {
  it('defaults and clamps into 1..10', () => {
    expect(clampRecommendationLimit(undefined)).toBe(4);
    expect(clampRecommendationLimit(0)).toBe(1);
    expect(clampRecommendationLimit(3)).toBe(3);
    expect(clampRecommendationLimit(99)).toBe(10);
  });
});

describe('taxonomy feature extraction', () => {
  it('extracts stable ids from taxonomy references', () => {
    expect(
      extractTagIds([
        { id: 'tag-a', names: { 'en-US': 'Fables' }, origin: 'manual' },
        { id: 'tag-b', names: { 'zh-CN': '寓言' }, origin: 'ai' },
      ]),
    ).toEqual(['tag-a', 'tag-b']);
    expect(extractCategoryId({ id: 'cat-fiction', names: { 'en-US': 'Fiction' }, origin: 'manual' })).toBe(
      'cat-fiction',
    );
    expect(extractCategoryId(null)).toBeNull();
  });
});

describe('recommendation score', () => {
  it('prefers closer difficulty and overlapping tag ids', () => {
    const anchor = feat({
      id: 'a',
      tagIds: ['tag-fables', 'tag-greek'],
      difficultyScore: 3,
      suggestedVocabSize: 3000,
      estimatedMinutes: 100,
    });
    const close = feat({
      id: 'close',
      tagIds: ['tag-fables'],
      difficultyScore: 3,
      suggestedVocabSize: 3200,
      estimatedMinutes: 110,
    });
    const far = feat({
      id: 'far',
      tagIds: ['tag-science'],
      difficultyScore: 5,
      suggestedVocabSize: 9000,
      estimatedMinutes: 400,
    });
    expect(scoreAgainstAnchor(anchor, close)).toBeGreaterThan(scoreAgainstAnchor(anchor, far));
  });

  it('matches tags by stable id regardless of display labels', () => {
    const anchor = feat({ id: 'a', tagIds: ['tag-shared'] });
    const sameIdDifferentLabel = feat({ id: 'b', tagIds: ['tag-shared'] });
    expect(scoreAgainstAnchor(anchor, sameIdDifferentLabel)).toBeGreaterThan(0);
  });

  it('skips missing numeric dimensions instead of inventing scores', () => {
    const anchor = feat({ id: 'a', tagIds: ['tag-fiction'], difficultyScore: 2 });
    const candidate = feat({ id: 'b', tagIds: ['tag-fiction'], difficultyScore: null, suggestedVocabSize: 1000 });
    expect(scoreAgainstAnchor(anchor, candidate)).toBeGreaterThan(0);
  });

  it('builds a shelf profile from tag id frequency and numeric medians', () => {
    const profile = buildShelfProfile([
      feat({ id: '1', tagIds: ['tag-a', 'tag-b'], difficultyScore: 2, suggestedVocabSize: 1000, estimatedMinutes: 40 }),
      feat({ id: '2', tagIds: ['tag-a'], difficultyScore: 4, suggestedVocabSize: 3000, estimatedMinutes: 80 }),
    ]);
    expect(profile?.tagIds[0]).toBe('tag-a');
    expect(profile?.difficultyScore).toBe(3);
    expect(profile?.suggestedVocabSize).toBe(2000);
    expect(profile?.estimatedMinutes).toBe(60);
  });

  it('resolves current → shelf_profile → cold_start', () => {
    const current = feat({
      id: 'cur',
      tagIds: ['tag-fables'],
      difficultyScore: 3,
      publishedAt: new Date('2026-01-01'),
    });
    const shelf = [current];
    const candidates = [
      feat({ id: 'match', tagIds: ['tag-fables'], difficultyScore: 3, publishedAt: new Date('2026-02-01') }),
      feat({ id: 'new', tagIds: ['tag-other'], difficultyScore: 5, publishedAt: new Date('2026-03-01') }),
    ];

    expect(resolveRecommendationOrder({ limit: 1, current, shelfWorks: shelf, candidates }).strategy).toBe('current');
    expect(resolveRecommendationOrder({ limit: 1, current: null, shelfWorks: shelf, candidates }).strategy).toBe(
      'shelf_profile',
    );
    expect(resolveRecommendationOrder({ limit: 1, current: null, shelfWorks: [], candidates }).orderedIds).toEqual([
      'new',
    ]);
  });
});
