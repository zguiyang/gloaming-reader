import { topNList } from 'nodewordfreq';
import model from 'wink-eng-lite-web-model';
import winkNLP from 'wink-nlp';

import {
  difficultyScoreFromVocabSize,
  estimatedMinutesFromWordCount,
  isEnglishLanguage,
  LEXICAL_COVERAGE_TARGET,
} from '@gloaming/shared/reading-stats';

const nlp = winkNLP(model, ['pos', 'ner']);
const its = nlp.its;

const LEMMA_RANK_LIST_SIZE = 60_000;
let lemmaRankMap: Map<string, number> | null = null;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lemmaRankMapLazy(): Map<string, number> {
  if (lemmaRankMap) {
    return lemmaRankMap;
  }
  const words = topNList('en', LEMMA_RANK_LIST_SIZE);
  const map = new Map<string, number>();
  for (let i = 0; i < words.length; i += 1) {
    const surface = words[i]!.toLowerCase();
    if (!map.has(surface)) {
      map.set(surface, i + 1);
    }
    const doc = nlp.readDoc(surface);
    doc.tokens().each((token: { out: (feature: unknown) => unknown }) => {
      const lemma = String(token.out(its.lemma)).toLowerCase();
      if (!map.has(lemma)) {
        map.set(lemma, i + 1);
      }
    });
  }
  lemmaRankMap = map;
  return map;
}

function lemmaRank(lemma: string): number {
  return lemmaRankMapLazy().get(lemma.toLowerCase()) ?? Number.POSITIVE_INFINITY;
}

export function countRunningWords(html: string): number {
  const text = stripHtml(html);
  if (!text) {
    return 0;
  }
  return text.split(/\s+/).filter(Boolean).length;
}

type AnalyzedToken = {
  lemmaRank: number;
};

function analyzePlainText(text: string): AnalyzedToken[] {
  if (!text.trim()) {
    return [];
  }
  const doc = nlp.readDoc(text);
  const tokens: AnalyzedToken[] = [];

  doc.tokens().each((token: { out: (feature: unknown) => unknown }) => {
    if (token.out(its.type) !== 'word') {
      return;
    }
    if (token.out(its.pos) === 'PROPN') {
      return;
    }
    const lemma = String(token.out(its.lemma)).toLowerCase();
    if (!lemma) {
      return;
    }
    tokens.push({ lemmaRank: lemmaRank(lemma) });
  });

  return tokens;
}

export function suggestedVocabSizeFromTokens(tokens: AnalyzedToken[]): number | null {
  if (tokens.length === 0) {
    return null;
  }
  const target = Math.ceil(tokens.length * LEXICAL_COVERAGE_TARGET);
  const ranks = [...new Set(tokens.map((t) => t.lemmaRank))].filter(Number.isFinite).sort((a, b) => a - b);
  const maxRank = ranks.at(-1);
  if (maxRank == null || !Number.isFinite(maxRank)) {
    return null;
  }

  let lo = 1;
  let hi = maxRank;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const covered = tokens.filter((t) => t.lemmaRank <= mid).length;
    if (covered >= target) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

export type PartReadingStats = {
  wordCount: number;
  estimatedMinutes: number | null;
};

export type WorkReadingStats = {
  wordCount: number;
  estimatedMinutes: number | null;
  suggestedVocabSize: number | null;
  difficultyScore: number | null;
  statsProvenance: 'algorithm';
};

export function computePartReadingStats(html: string): PartReadingStats {
  const wordCount = countRunningWords(html);
  return {
    wordCount,
    estimatedMinutes: estimatedMinutesFromWordCount(wordCount),
  };
}

export function computeWorkReadingStats(parts: { body: string }[], language: string): WorkReadingStats {
  let wordCount = 0;
  const analyzed: AnalyzedToken[] = [];

  for (const part of parts) {
    const plain = stripHtml(part.body);
    wordCount += countRunningWords(part.body);
    if (isEnglishLanguage(language)) {
      analyzed.push(...analyzePlainText(plain));
    }
  }

  const estimatedMinutes = estimatedMinutesFromWordCount(wordCount);
  if (!isEnglishLanguage(language)) {
    return {
      wordCount,
      estimatedMinutes,
      suggestedVocabSize: null,
      difficultyScore: null,
      statsProvenance: 'algorithm',
    };
  }

  const suggestedVocabSize = suggestedVocabSizeFromTokens(analyzed);
  const difficultyScore = suggestedVocabSize != null ? difficultyScoreFromVocabSize(suggestedVocabSize) : null;

  return {
    wordCount,
    estimatedMinutes,
    suggestedVocabSize,
    difficultyScore,
    statsProvenance: 'algorithm',
  };
}

/** Test-only reset for lazy lemma rank cache. */
export function resetReadingStatsCacheForTests(): void {
  lemmaRankMap = null;
}

export { analyzePlainText };
