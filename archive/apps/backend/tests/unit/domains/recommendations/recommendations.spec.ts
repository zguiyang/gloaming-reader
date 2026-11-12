import { describe, expect, it } from 'vitest';

import { clampRecommendationLimit } from '@gloaming/shared/recommendations';

import {
  buildShelfProfile,
  type RecommendationFeatures,
  resolveRecommendationOrder,
  scoreAgainstAnchor,
} from '@/domains/recommendations';

function feat(partial: Partial<RecommendationFeatures> & Pick<RecommendationFeatures, 'id'>): RecommendationFeatures {
  return {
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

describe('recommendation score', () => {
  it('prefers closer difficulty and reading-size metrics', () => {
    const anchor = feat({
      id: 'a',
      difficultyScore: 3,
      suggestedVocabSize: 3000,
      estimatedMinutes: 100,
    });
    const close = feat({
      id: 'close',
      difficultyScore: 3,
      suggestedVocabSize: 3200,
      estimatedMinutes: 110,
    });
    const far = feat({
      id: 'far',
      difficultyScore: 5,
      suggestedVocabSize: 9000,
      estimatedMinutes: 400,
    });
    expect(scoreAgainstAnchor(anchor, close)).toBeGreaterThan(scoreAgainstAnchor(anchor, far));
  });

  it('skips missing numeric dimensions instead of inventing scores', () => {
    const anchor = feat({ id: 'a', difficultyScore: 2 });
    const candidate = feat({ id: 'b', difficultyScore: null, suggestedVocabSize: 1000 });
    expect(scoreAgainstAnchor(anchor, candidate)).toBe(0);
  });

  it('builds a shelf profile from numeric medians', () => {
    const profile = buildShelfProfile([
      feat({ id: '1', difficultyScore: 2, suggestedVocabSize: 1000, estimatedMinutes: 40 }),
      feat({ id: '2', difficultyScore: 4, suggestedVocabSize: 3000, estimatedMinutes: 80 }),
    ]);
    expect(profile?.difficultyScore).toBe(3);
    expect(profile?.suggestedVocabSize).toBe(2000);
    expect(profile?.estimatedMinutes).toBe(60);
  });

  it('resolves current → shelf_profile → cold_start', () => {
    const current = feat({
      id: 'cur',
      difficultyScore: 3,
      publishedAt: new Date('2026-01-01'),
    });
    const shelf = [current];
    const candidates = [
      feat({ id: 'match', difficultyScore: 3, publishedAt: new Date('2026-02-01') }),
      feat({ id: 'new', difficultyScore: 5, publishedAt: new Date('2026-03-01') }),
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
