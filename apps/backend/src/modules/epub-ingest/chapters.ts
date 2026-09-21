import * as cheerio from 'cheerio';

import { reindexLeafParagraphOrdinals } from '@/modules/works/part-content/paragraph-identity';

import type { CleanedChapter, EpubBook, EpubNavItem } from './types';

/**
 * Chaptering — port of textstack's EpubTextExtractor rules:
 * 1. nav/NCX title map wins (first nav entry per file, file-name lookalikes
 *    rejected); visible h1/h2/h3 fallback (never <head><title>).
 * 2. Single-file EPUBs split on h2/h3 headings (skip patterns + leading
 *    front-matter headings dropped); titles get Part/Chapter prefixes.
 * 3. Untitled spine files merge into the previous chapter; cover/blank pages
 *    (no readable text) drop entirely.
 * 4. Bare chapter-number stubs merge with the following body, keeping the
 *    nav-derived title.
 * 5. Short chapters matching front/back-matter keywords are kept and titled
 *    by their type (Copyright / Contents / Acknowledgments / …); contentless
 *    cover pages and piracy-watermark pages are skipped.
 */

export type SplitChapter = {
  title: string | null;
  html: string;
};

const MAX_HEADING_TITLE_CHARS = 100;

/** Headings skipped when splitting a single-file EPUB (textstack skipPatterns). */
const SPLIT_SKIP_PATTERNS = [
  'novel by',
  'books by',
  'the end',
  'copyright',
  'published by',
  'printed in',
  'all rights reserved',
  'table of contents',
  'about the author',
  'acknowledgment',
  'acknowledgement',
];

const CHAPTER_PART_PATTERN =
  /^(chapter|part|book|section|глава|часть|частина|розділ|prologue|epilogue|appendix|introduction|preface|foreword)\b/i;

const ROMAN_NUMERALS = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XVI',
  'XVII',
  'XVIII',
  'XIX',
  'XX',
];

const NUMBER_WORDS = [
  'ONE',
  'TWO',
  'THREE',
  'FOUR',
  'FIVE',
  'SIX',
  'SEVEN',
  'EIGHT',
  'NINE',
  'TEN',
  'ELEVEN',
  'TWELVE',
  'THIRTEEN',
  'FOURTEEN',
  'FIFTEEN',
  'SIXTEEN',
  'SEVENTEEN',
  'EIGHTEEN',
  'NINETEEN',
  'TWENTY',
];

/** Piracy watermark phrases (textstack PiracyWatermarkProcessor). */
const PIRACY_PHRASES = [
  'Downloaded from',
  'Thanks for downloading',
  'free ebook library',
  'pirate library',
  'support the author by purchasing',
  'This ebook was created',
  'Converted by',
  'Спасибо, что скачали',
  'скачали книгу',
  'бесплатной электронной библиотеке',
  'Все книги автора',
  'книга в других форматах',
  'Приятного чтения',
  'Оцените книгу',
  'Скачать бесплатно',
  'электронная библиотека',
  'Конвертация выполнена',
  'FictionBook Editor',
  'Эта же книга в других форматах',
];

/** File-name lookalike titles (e.g. "code_1", "chapter-01") are rejected. */
function looksLikeFileName(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  return /^[A-Za-z0-9_-]+$/.test(normalized) && /[_-]\d+|^\d+[_-]/.test(normalized);
}

/** Placeholder titles from Calibre/Word conversions (textstack ExtractHeadingTitle). */
function isRejectedHeadingTitle(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return lower === 'unknown' || lower === 'untitled';
}

/** Front/back-matter type detection for short sections (textstack DetectFrontMatterType). */
function detectFrontMatterType(html: string): string | null {
  if (!html || html.length > 3000) return null;
  const lower = html.toLowerCase();
  if (lower.includes('copyright') || lower.includes('©') || lower.includes('all rights reserved')) {
    return 'Copyright';
  }
  if (lower.includes('table of contents')) return 'Contents';
  if (html.length < 1500) {
    if (lower.includes('acknowledgment') || lower.includes('acknowledgement')) return 'Acknowledgments';
    if (lower.includes('about the author')) return 'About the Author';
    if (lower.includes('afterword')) return 'Afterword';
    if (lower.includes('appendix')) return 'Appendix';
  }
  return null;
}

/** Piracy-watermark chapter (whole chapter skipped, textstack behavior). */
function isPiracyWatermark(html: string): boolean {
  const lower = html.toLowerCase();
  return PIRACY_PHRASES.some((phrase) => lower.includes(phrase.toLowerCase()));
}

/** True when a heading text looks like a part/chapter marker. */
function isChapterOrPartHeading(text: string): boolean {
  if (CHAPTER_PART_PATTERN.test(text)) return true;
  const upper = text.trim().toUpperCase();
  if (ROMAN_NUMERALS.includes(upper)) return true;
  if (NUMBER_WORDS.includes(upper)) return true;
  if (/^\d+$/.test(text.trim())) return true;
  return false;
}

/**
 * Split a single-file EPUB by h2/h3 headings (textstack SplitSingleFileByHeadings):
 * skip-pattern headings are ignored, headings before the first part/chapter
 * marker are dropped, and display titles get Part/Chapter prefixes.
 */
export function splitSingleFileByHeadings(html: string): SplitChapter[] {
  const $ = cheerio.load(html, null, false);
  const headings = $('h2, h3')
    .toArray()
    .map((el) => ({ el, title: $(el).text().replace(/\s+/g, ' ').trim() }))
    .filter((heading) => {
      const text = heading.title;
      if (!text || text.length > MAX_HEADING_TITLE_CHARS) return false;
      const lower = text.toLowerCase();
      return !SPLIT_SKIP_PATTERNS.some((pattern) => lower.includes(pattern));
    });

  // Drop everything before the first part/chapter marker (title-page headings).
  const firstPartIndex = headings.findIndex((heading) => isChapterOrPartHeading(heading.title));
  if (firstPartIndex > 0) {
    headings.splice(0, firstPartIndex);
  }

  if (headings.length < 2) return [];

  const sections: SplitChapter[] = [];
  let currentPartName: string | null = null;

  for (let i = 0; i < headings.length; i += 1) {
    const start = headings[i]!;
    const end = headings[i + 1]?.el ?? null;
    const isPartHeading = start.el.tagName === 'h2';
    if (isPartHeading) {
      currentPartName = start.title;
    }

    const parent = $(start.el).parent();
    const children = parent.length > 0 ? parent.children().toArray() : $.root().children().toArray();
    const htmlBuf: string[] = [];
    let started = false;
    for (const child of children) {
      if (child === start.el) {
        started = true;
      }
      if (!started) continue;
      if (end && child === end) break;
      // An <hr> right before the next heading belongs to the previous section.
      if (end && child.nextSibling === end && child.tagName === 'hr') break;
      htmlBuf.push($.html(child));
    }

    const sectionHtml = htmlBuf.join('').trim();
    if (!sectionHtml) continue;

    let displayTitle: string;
    if (isPartHeading) {
      displayTitle = `Part ${start.title}`;
    } else if (currentPartName !== null) {
      displayTitle = `Part ${currentPartName}, Chapter ${start.title}`;
    } else {
      displayTitle = `Chapter ${start.title}`;
    }

    sections.push({ title: displayTitle, html: sectionHtml });
  }
  return sections.length >= 2 ? sections : [];
}

/** True when a unit is just a chapter-number heading (e.g. "<h1>10</h1>"). */
function isHeadingNumberStub(html: string): boolean {
  const $ = cheerio.load(html, null, false);
  const text = $.root().text().trim();
  if (!text) return false;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const wordCount = collapsed.split(/\s+/).filter(Boolean).length;
  if (wordCount > 3) return false;
  return /^\d{1,3}$/.test(collapsed);
}

function buildNavTitleMap(nav: EpubNavItem[]): Map<string, string> {
  // First nav entry per file wins (matches textstack) — later navPoints that
  // point into the same file (e.g. per-fable NCX entries) must not overwrite
  // the file's chapter title.
  const map = new Map<string, string>();
  for (const item of nav) {
    if (!map.has(item.href)) {
      map.set(item.href, item.label.trim());
    }
  }
  return map;
}

function firstVisibleHeadingTitle(html: string): string | null {
  const $ = cheerio.load(html, null, false);
  for (const tag of ['h1', 'h2', 'h3']) {
    const $h = $(tag).first();
    if ($h.length === 0) continue;
    const title = $h.text().replace(/\s+/g, ' ').trim();
    if (title && title.length <= MAX_HEADING_TITLE_CHARS && !isRejectedHeadingTitle(title)) return title;
  }
  return null;
}

/** True when the cleaned HTML carries any visible text — cover/blank pages don't. */
function hasReadableText(html: string): boolean {
  const $ = cheerio.load(html, null, false);
  return Boolean($.root().text().trim());
}

/** Chapter title fallback chain (textstack GetChapterTitle). */
function resolveChapterTitle(input: {
  navTitle: string | null;
  headingTitle: string | null;
  rawHtml: string;
  chapterNumber: number;
}): { title: string; hasProperTitle: boolean } {
  const { navTitle, headingTitle, rawHtml, chapterNumber } = input;
  if (navTitle && !looksLikeFileName(navTitle)) {
    return { title: navTitle, hasProperTitle: true };
  }
  if (headingTitle && !looksLikeFileName(headingTitle)) {
    return { title: headingTitle, hasProperTitle: true };
  }
  const frontMatterType = detectFrontMatterType(rawHtml);
  if (frontMatterType) {
    return { title: frontMatterType, hasProperTitle: true };
  }
  return { title: `Section ${chapterNumber}`, hasProperTitle: false };
}

export type ChapterPlan = {
  title: string;
  html: string;
};

/**
 * Build the ordered chapter plan from spine files + cleaned HTML + nav.
 * `clean` transforms raw XHTML into { html, images }.
 */
export function planChapters(book: EpubBook, clean: (href: string, rawHtml: string) => CleanedChapter): ChapterPlan[] {
  const navTitleMap = buildNavTitleMap(book.nav);
  const chapters: ChapterPlan[] = [];
  let previous: ChapterPlan | null = null;

  // Single-file EPUB: try heading split first.
  if (book.spine.length === 1) {
    const href = book.spine[0]!.href;
    const raw = book.entries.get(href);
    if (raw) {
      const sections = splitSingleFileByHeadings(raw.toString('utf8'));
      if (sections.length > 0) {
        for (const section of sections) {
          const cleaned = clean(href, section.html);
          if (!hasReadableText(cleaned.html)) continue;
          chapters.push({ title: section.title ?? '', html: cleaned.html });
        }
        return finalizeChapterParagraphOrdinals(chapters);
      }
    }
  }

  for (const spineItem of book.spine) {
    const raw = book.entries.get(spineItem.href);
    if (!raw) continue;
    const rawHtml = raw.toString('utf8');
    const cleaned = clean(spineItem.href, rawHtml);
    const html = cleaned.html;
    if (!hasReadableText(html)) continue;

    // Piracy-watermark chapters are skipped entirely.
    if (isPiracyWatermark(html)) continue;

    const navTitle = navTitleMap.get(spineItem.href) ?? null;
    const headingTitle = firstVisibleHeadingTitle(html);
    const { title, hasProperTitle } = resolveChapterTitle({
      navTitle,
      headingTitle,
      rawHtml,
      chapterNumber: chapters.length + 1,
    });

    // Untitled file (no nav/heading/front-matter) → merge into previous chapter.
    if (!hasProperTitle && previous) {
      previous.html = `${previous.html}\n${html}`;
      continue;
    }

    // Bare chapter-number stub as previous chapter → merge body in, keep title.
    if (previous && isHeadingNumberStub(previous.html) && hasProperTitle) {
      previous.html = `${previous.html}\n${html}`;
      continue;
    }

    const chapter: ChapterPlan = { title, html };
    chapters.push(chapter);
    previous = chapter;
  }

  return finalizeChapterParagraphOrdinals(chapters);
}

/** After spine merges, renumber leaf data-p so each chapter has unique ordinals. */
function finalizeChapterParagraphOrdinals(chapters: ChapterPlan[]): ChapterPlan[] {
  return chapters.map((chapter) => ({
    ...chapter,
    html: reindexLeafParagraphOrdinals(chapter.html),
  }));
}
