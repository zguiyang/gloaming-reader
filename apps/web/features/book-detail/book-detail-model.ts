import { DEFAULT_LOCALE, type Locale, t } from '@gloaming/i18n';
import { resolveLocalizedText, type TaxonomyReference } from '@gloaming/shared/taxonomy';

/** Reading lifecycle for book detail CTA / progress chrome. */
export type BookReadingStatus = 'unread' | 'in_progress' | 'completed';

export type BookChapterStatus = 'read' | 'current' | 'unread';

export type BookChapter = {
  id: string;
  index: number;
  title: string;
  estimatedMinutes: number | null;
  wordCount: number | null;
  status: BookChapterStatus;
};

export type BookDetailShelfStatus = 'available' | 'on_shelf';

export type BookDetailSourceLabel = 'official';

/** Sentinel when work has no taxonomy tag for category display. */
export const BOOK_DETAIL_DEFAULT_CATEGORY = '__default_category__' as const;

export type BookDetailCategory = TaxonomyReference | typeof BOOK_DETAIL_DEFAULT_CATEGORY;

export type BookDetail = {
  id: string;
  title: string;
  author: string;
  difficultyScore: number | null;
  difficultyLabel: string | null;
  category: BookDetailCategory;
  tags: TaxonomyReference[];
  estimatedMinutes: number | null;
  suggestedVocabSize: number | null;
  teaser: string;
  sourceLabel: BookDetailSourceLabel;
  /** BCP-47 language tag from catalog work — display via {@link languageLabelFromCode}. */
  language: string;
  languageLabel: string;
  coverImageUrl: string | null;
  shelfStatus: BookDetailShelfStatus;
  readingStatus: BookReadingStatus;
  progressRatio: number | null;
  lastReadAt: string | null;
  completedAt: string | null;
  chapters: BookChapter[];
  relatedIds: string[];
};

/** Display fields for the book-detail related / recommendations rail only. */
export type RelatedBookCard = {
  id: string;
  title: string;
  tags: TaxonomyReference[];
  coverImageUrl: string | null;
  difficultyLabel: string | null;
  estimatedMinutes: number | null;
};

export function primaryReadLabel(status: BookReadingStatus, locale: Locale = DEFAULT_LOCALE): string {
  if (status === 'in_progress') {
    return t(locale, 'content.bookDetail.readContinue');
  }
  if (status === 'completed') {
    return t(locale, 'content.bookDetail.readAgain');
  }
  return t(locale, 'content.bookDetail.readStart');
}

export function formatRelativeReadTime(
  iso: string | null,
  now = new Date(),
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (!iso) {
    return null;
  }
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) {
    return null;
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(then)) / dayMs);
  const time = then.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (dayDiff === 0) {
    return t(locale, 'content.bookDetail.relativeToday', { time });
  }
  if (dayDiff === 1) {
    return t(locale, 'content.bookDetail.relativeYesterday', { time });
  }
  return then.toLocaleDateString(locale, { month: 'long', day: 'numeric' });
}

export function formatMinutes(minutes: number | null, locale: Locale = DEFAULT_LOCALE): string | null {
  if (minutes == null) {
    return null;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0
      ? t(locale, 'content.bookDetail.hoursAndMinutes', { hours, minutes: rest })
      : t(locale, 'content.bookDetail.hours', { hours });
  }
  return t(locale, 'content.bookDetail.minutes', { minutes });
}

export function formatSuggestedVocabSize(size: number): string {
  if (size >= 1000) {
    const k = size / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(size);
}

/** Filled stars out of 5 from backend difficultyScore (1–5). */
export function difficultyStarCount(score: number): number {
  return Math.min(5, Math.max(1, Math.round(score)));
}

export function chapterStatusLabel(status: BookChapterStatus, locale: Locale = DEFAULT_LOCALE): string {
  if (status === 'read') {
    return t(locale, 'content.bookDetail.chapterStatusRead');
  }
  if (status === 'current') {
    return t(locale, 'content.bookDetail.chapterStatusCurrent');
  }
  return t(locale, 'content.bookDetail.chapterStatusUnread');
}

/** 1-based chapter index for TOC — Arabic numerals, no zero-pad (e.g. `1`). */
export function chapterOrdinalLabel(index: number): string {
  return String(index);
}

export function formatChapterTitle(
  chapter: Pick<BookChapter, 'index' | 'title'>,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const trimmed = chapter.title.trim();
  if (trimmed) {
    return trimmed;
  }
  return t(locale, 'content.bookDetail.chapterFallback', { n: chapter.index });
}

export function taxonomyDisplayName(ref: TaxonomyReference, locale: Locale = DEFAULT_LOCALE): string {
  return resolveLocalizedText(ref.names, locale);
}

/** Stable WorkCover tint seeds — taxonomy ids, not locale-specific labels. */
export function taxonomyCoverTintSeeds(refs: readonly TaxonomyReference[]): string[] {
  return refs.map((ref) => ref.id);
}

export function formatBookCategory(category: BookDetailCategory, locale: Locale = DEFAULT_LOCALE): string {
  if (category === BOOK_DETAIL_DEFAULT_CATEGORY) {
    return t(locale, 'content.bookDetail.defaultCategory');
  }
  return resolveLocalizedText(category.names, locale);
}

export function formatSourceLabel(source: BookDetailSourceLabel, locale: Locale = DEFAULT_LOCALE): string {
  if (source === 'official') {
    return t(locale, 'content.bookDetail.sourceOfficial');
  }
  return source;
}

export function readingStatusFromProgress(
  status: 'in_progress' | 'completed' | null,
  progressRatio: number | null,
): BookReadingStatus {
  if (status === 'completed') {
    return 'completed';
  }
  if (status === 'in_progress' && progressRatio != null && progressRatio > 0) {
    return 'in_progress';
  }
  return 'unread';
}

export function languageLabelFromCode(language: string, locale: Locale = DEFAULT_LOCALE): string {
  const code = language.trim().toLowerCase();
  if (code === 'en' || code.startsWith('en-')) {
    return t(locale, 'content.bookDetail.languageOriginalEn');
  }
  const trimmed = language.trim();
  return trimmed || t(locale, 'content.bookDetail.languageOriginal');
}

export function teaserFromDescription(description: string, maxLen = 180): string {
  const desc = description.trim().replace(/\s+/g, ' ');
  if (!desc) {
    return '';
  }
  return desc.length > maxLen ? `${desc.slice(0, maxLen - 3)}…` : desc;
}
