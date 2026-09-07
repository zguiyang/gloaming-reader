/** Fixed English reading speed for estimated minutes (SSOT). */
export const READING_WPM = 200 as const;

/** Nation-style lexical coverage target for suggested vocabulary size. */
export const LEXICAL_COVERAGE_TARGET = 0.95 as const;

export const WORK_STATS_PROVENANCES = ['algorithm', 'manual'] as const;
export type WorkStatsProvenance = (typeof WORK_STATS_PROVENANCES)[number];

export const DIFFICULTY_SCORE_MIN = 1 as const;
export const DIFFICULTY_SCORE_MAX = 5 as const;

/** Map suggested vocabulary size → 1–5 difficulty for catalog/detail UI. */
export function difficultyScoreFromVocabSize(vocabSize: number): number {
  if (vocabSize <= 1000) {
    return 1;
  }
  if (vocabSize <= 2000) {
    return 2;
  }
  if (vocabSize <= 4000) {
    return 3;
  }
  if (vocabSize <= 6000) {
    return 4;
  }
  return 5;
}

const DIFFICULTY_LABEL: Record<number, string> = {
  1: '入门',
  2: '简单',
  3: '中等',
  4: '较难',
  5: '挑战',
};

export function difficultyLabelFromScore(score: number): string {
  return DIFFICULTY_LABEL[score] ?? DIFFICULTY_LABEL[3]!;
}

export function estimatedMinutesFromWordCount(wordCount: number): number | null {
  if (wordCount <= 0) {
    return null;
  }
  return Math.max(1, Math.ceil(wordCount / READING_WPM));
}

export function isEnglishLanguage(language: string): boolean {
  const code = language.trim().toLowerCase();
  return code === 'en' || code.startsWith('en-');
}
