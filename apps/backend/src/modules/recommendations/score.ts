import type { RecommendationStrategy } from '@gloaming/shared/recommendations';
import type { TaxonomyReference } from '@gloaming/shared/taxonomy';

export type RecommendationFeatures = {
  id: string;
  tagIds: string[];
  categoryId: string | null;
  language: string;
  difficultyScore: number | null;
  suggestedVocabSize: number | null;
  estimatedMinutes: number | null;
  publishedAt: Date | null;
};

/** Stable tag ids for recommendation scoring — not locale display labels. */
export function extractTagIds(tags: TaxonomyReference[]): string[] {
  return tags.map((tag) => tag.id);
}

/** Stable category id for recommendation scoring — not locale display labels. */
export function extractCategoryId(category: TaxonomyReference | null | undefined): string | null {
  return category?.id ?? null;
}

const WEIGHT_TAG = 0.3;
const WEIGHT_CATEGORY = 0.15;
const WEIGHT_DIFFICULTY = 0.25;
const WEIGHT_VOCAB = 0.2;
const WEIGHT_MINUTES = 0.1;
const PROFILE_TAG_TOP_K = 5;

function relativeProximity(a: number, b: number): number {
  const r = Math.abs(a - b) / Math.max(a, 1);
  if (r <= 0.25) {
    return 1;
  }
  if (r <= 0.5) {
    return 0.5;
  }
  return 0;
}

function difficultyProximity(a: number, b: number): number {
  const delta = Math.abs(a - b);
  if (delta === 0) {
    return 1;
  }
  if (delta === 1) {
    return 0.7;
  }
  if (delta === 2) {
    return 0.3;
  }
  return 0;
}

function tagOverlap(anchorTagIds: string[], candidateTagIds: string[]): number {
  if (anchorTagIds.length === 0 || candidateTagIds.length === 0) {
    return Number.NaN;
  }
  const candidate = new Set(candidateTagIds);
  let intersection = 0;
  for (const tagId of anchorTagIds) {
    if (candidate.has(tagId)) {
      intersection += 1;
    }
  }
  return intersection / anchorTagIds.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** Aggregate shelf works into a profile anchor (null when empty). */
export function buildShelfProfile(works: RecommendationFeatures[]): RecommendationFeatures | null {
  if (works.length === 0) {
    return null;
  }

  const tagCounts = new Map<string, number>();
  for (const work of works) {
    for (const tagId of work.tagIds) {
      tagCounts.set(tagId, (tagCounts.get(tagId) ?? 0) + 1);
    }
  }
  const tagIds = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, PROFILE_TAG_TOP_K)
    .map(([id]) => id);

  const categoryCounts = new Map<string, number>();
  for (const work of works) {
    if (!work.categoryId) {
      continue;
    }
    categoryCounts.set(work.categoryId, (categoryCounts.get(work.categoryId) ?? 0) + 1);
  }
  let categoryId: string | null = null;
  let bestCount = 0;
  for (const [id, count] of categoryCounts) {
    if (count > bestCount) {
      bestCount = count;
      categoryId = id;
    }
  }

  const languageCounts = new Map<string, number>();
  for (const work of works) {
    const code = work.language.trim().toLowerCase() || 'en';
    languageCounts.set(code, (languageCounts.get(code) ?? 0) + 1);
  }
  let language = 'en';
  let langBest = 0;
  for (const [code, count] of languageCounts) {
    if (count > langBest) {
      langBest = count;
      language = code;
    }
  }

  return {
    id: 'shelf-profile',
    tagIds,
    categoryId,
    language,
    difficultyScore: median(works.map((w) => w.difficultyScore).filter((v): v is number => v != null)),
    suggestedVocabSize: median(works.map((w) => w.suggestedVocabSize).filter((v): v is number => v != null)),
    estimatedMinutes: median(works.map((w) => w.estimatedMinutes).filter((v): v is number => v != null)),
    publishedAt: null,
  };
}

/**
 * Weighted score in [0, 1]; dimensions with missing data on either side are skipped.
 * Returns 0 when no dimension could be scored.
 */
export function scoreAgainstAnchor(anchor: RecommendationFeatures, candidate: RecommendationFeatures): number {
  const parts: { weight: number; score: number }[] = [];

  const tags = tagOverlap(anchor.tagIds, candidate.tagIds);
  if (Number.isFinite(tags)) {
    parts.push({ weight: WEIGHT_TAG, score: tags });
  }

  if (anchor.categoryId && candidate.categoryId) {
    parts.push({ weight: WEIGHT_CATEGORY, score: anchor.categoryId === candidate.categoryId ? 1 : 0 });
  }

  if (anchor.difficultyScore != null && candidate.difficultyScore != null) {
    parts.push({
      weight: WEIGHT_DIFFICULTY,
      score: difficultyProximity(anchor.difficultyScore, candidate.difficultyScore),
    });
  }

  if (anchor.suggestedVocabSize != null && candidate.suggestedVocabSize != null) {
    parts.push({
      weight: WEIGHT_VOCAB,
      score: relativeProximity(anchor.suggestedVocabSize, candidate.suggestedVocabSize),
    });
  }

  if (anchor.estimatedMinutes != null && candidate.estimatedMinutes != null) {
    parts.push({
      weight: WEIGHT_MINUTES,
      score: relativeProximity(anchor.estimatedMinutes, candidate.estimatedMinutes),
    });
  }

  if (parts.length === 0) {
    return 0;
  }

  const weightSum = parts.reduce((sum, part) => sum + part.weight, 0);
  return parts.reduce((sum, part) => sum + part.weight * part.score, 0) / weightSum;
}

export function rankByScore(
  anchor: RecommendationFeatures,
  candidates: RecommendationFeatures[],
  limit: number,
): RecommendationFeatures[] {
  return [...candidates]
    .map((candidate) => ({
      candidate,
      score: scoreAgainstAnchor(anchor, candidate),
      publishedAtMs: candidate.publishedAt?.getTime() ?? 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.publishedAtMs !== a.publishedAtMs) {
        return b.publishedAtMs - a.publishedAtMs;
      }
      return a.candidate.id.localeCompare(b.candidate.id);
    })
    .slice(0, limit)
    .map((row) => row.candidate);
}

export function rankByPublishedAt(candidates: RecommendationFeatures[], limit: number): RecommendationFeatures[] {
  return [...candidates]
    .sort((a, b) => {
      const aMs = a.publishedAt?.getTime() ?? 0;
      const bMs = b.publishedAt?.getTime() ?? 0;
      if (bMs !== aMs) {
        return bMs - aMs;
      }
      return b.id.localeCompare(a.id);
    })
    .slice(0, limit);
}

export type ResolvedRecommendationPlan = {
  strategy: RecommendationStrategy;
  anchorWorkId: string | null;
  orderedIds: string[];
};

export function resolveRecommendationOrder(input: {
  limit: number;
  current: RecommendationFeatures | null;
  shelfWorks: RecommendationFeatures[];
  candidates: RecommendationFeatures[];
}): ResolvedRecommendationPlan {
  const { limit, current, shelfWorks, candidates } = input;

  if (current) {
    return {
      strategy: 'current',
      anchorWorkId: current.id,
      orderedIds: rankByScore(current, candidates, limit).map((w) => w.id),
    };
  }

  const profile = buildShelfProfile(shelfWorks);
  if (profile) {
    return {
      strategy: 'shelf_profile',
      anchorWorkId: null,
      orderedIds: rankByScore(profile, candidates, limit).map((w) => w.id),
    };
  }

  return {
    strategy: 'cold_start',
    anchorWorkId: null,
    orderedIds: rankByPublishedAt(candidates, limit).map((w) => w.id),
  };
}
