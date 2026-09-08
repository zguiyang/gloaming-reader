import type { TranslateSentenceEn } from '@gloaming/shared/translate';

/** View-facing bilingual translation payload for content rendering. */
export type BilingualTranslationData = {
  sentences: TranslateSentenceEn[];
  translationsByIndex: Record<number, string>;
  titleZh: string | null;
  isLoading: boolean;
  isStreaming: boolean;
};
