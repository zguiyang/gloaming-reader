import * as cheerio from 'cheerio';

import type { ChapterImageRef } from '@/modules/epub-ingest/types';

/** Ingest placeholder token prefix — must match epub-ingest/parser. */
export const IMAGE_PLACEHOLDER_PREFIX = '__GLOAMING_IMG__';

const FIGURE_SHELL_SELECTOR = '.figcenter, .figleft, .figright, figure';

export function isLocalImageHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  if (/^(https?:|data:|blob:|\/\/)/i.test(trimmed)) return false;
  return true;
}

function detectImageMime(src: string): string {
  const lower = src.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.avif')) return 'image/avif';
  return 'image/jpeg';
}

/** Decode percent-encoding when present; keep `../` for chapter-relative resolve. */
function softNormalizeLocalHref(href: string): string {
  const noHash = href.trim().split('#')[0]!.trim();
  if (!noHash) return '';
  try {
    return decodeURIComponent(noHash);
  } catch {
    return noHash;
  }
}

/** Remove an img (or its empty figure shell) so reading is not interrupted. */
export function removeImgOrFigureShell($: cheerio.CheerioAPI, $img: cheerio.Cheerio<never>): void {
  const $shell = $img.closest(FIGURE_SHELL_SELECTOR);
  if ($shell.length) {
    $shell.remove();
    return;
  }
  $img.remove();
}

/**
 * Rewrite/collect local images (placeholder token), keep external and
 * data:image srcs as-is (textstack behavior), drop srcset (single src wins —
 * local srcset entries cannot be proxied).
 */
export function collectAndRewriteImages(
  $: cheerio.CheerioAPI,
  rewriteImageSrc: (href: string) => string,
  images: ChapterImageRef[],
  seenImages: Set<string>,
): void {
  $('img').each((_, el) => {
    const $img = $(el);
    const src = $img.attr('src') ?? '';
    $img.removeAttr('srcset');
    if (!isLocalImageHref(src)) {
      return;
    }
    const normalized = softNormalizeLocalHref(src);
    if (!normalized) {
      $img.remove();
      return;
    }
    const key = normalized.toLowerCase();
    if (!seenImages.has(key)) {
      seenImages.add(key);
      images.push({ href: normalized, mime: detectImageMime(normalized) });
    }
    $img.attr('src', rewriteImageSrc(normalized));
  });
}

/**
 * Drop `<img>` whose src is an unresolved ingest placeholder (zip miss).
 * `keepTokens` are placeholders that successfully resolved to package bytes.
 */
export function stripOrphanImagePlaceholders(html: string, keepTokens: ReadonlySet<string>): string {
  if (!html.includes(IMAGE_PLACEHOLDER_PREFIX)) {
    return html;
  }
  const $ = cheerio.load(html, null, false);
  $('img').each((_, el) => {
    const $img = $(el);
    const src = $img.attr('src') ?? '';
    if (!src.includes(IMAGE_PLACEHOLDER_PREFIX)) return;
    if (keepTokens.has(src)) return;
    removeImgOrFigureShell($, $img as cheerio.Cheerio<never>);
  });
  return ($.root().html() ?? html).trim();
}
