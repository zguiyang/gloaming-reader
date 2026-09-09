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

export type BookDetail = {
  id: string;
  title: string;
  author: string;
  difficultyScore: number | null;
  difficultyLabel: string | null;
  category: string;
  tags: string[];
  estimatedMinutes: number | null;
  suggestedVocabSize: number | null;
  teaser: string;
  sourceLabel: '官方';
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
  tags: string[];
  coverImageUrl: string | null;
  difficultyLabel: string | null;
  estimatedMinutes: number | null;
};

export function primaryReadLabel(status: BookReadingStatus): string {
  if (status === 'in_progress') {
    return '继续阅读';
  }
  if (status === 'completed') {
    return '再次阅读';
  }
  return '开始阅读';
}

export function formatRelativeReadTime(iso: string | null, now = new Date()): string | null {
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
  const time = then.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (dayDiff === 0) {
    return `今天 ${time}`;
  }
  if (dayDiff === 1) {
    return `昨天 ${time}`;
  }
  return then.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

export function formatMinutes(minutes: number | null): string | null {
  if (minutes == null) {
    return null;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
  }
  return `${minutes} 分钟`;
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

export function chapterStatusLabel(status: BookChapterStatus): string {
  if (status === 'read') {
    return '已读';
  }
  if (status === 'current') {
    return '正在阅读';
  }
  return '未读';
}

/** 1-based chapter index for TOC — Arabic numerals, no zero-pad (e.g. `1`). */
export function chapterOrdinalLabel(index: number): string {
  return String(index);
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

export function languageLabelFromCode(language: string): string {
  const code = language.trim().toLowerCase();
  if (code === 'en' || code.startsWith('en-')) {
    return '英文原版';
  }
  return language.trim() || '原文';
}

export function teaserFromDescription(description: string, maxLen = 180): string {
  const desc = description.trim().replace(/\s+/g, ' ');
  if (!desc) {
    return '';
  }
  return desc.length > maxLen ? `${desc.slice(0, maxLen - 3)}…` : desc;
}
