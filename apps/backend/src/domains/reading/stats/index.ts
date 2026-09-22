export type { PartReadingStats, WorkReadingStats } from '@/domains/reading/stats/service';
export {
  analyzePlainText,
  computePartReadingStats,
  computeWorkReadingStats,
  countRunningWords,
  resetReadingStatsCacheForTests,
  suggestedVocabSizeFromTokens,
} from '@/domains/reading/stats/service';
