export type { PartReadingStats, WorkReadingStats } from '@/server/domains/reading/stats/service';
export {
  analyzePlainText,
  computePartReadingStats,
  computeWorkReadingStats,
  countRunningWords,
  resetReadingStatsCacheForTests,
  suggestedVocabSizeFromTokens,
} from '@/server/domains/reading/stats/service';
