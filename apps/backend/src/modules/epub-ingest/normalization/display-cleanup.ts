import type * as cheerio from 'cheerio';

import { removeImgOrFigureShell } from '@/modules/epub-ingest/normalization/images';

const FIGURE_SHELL_SELECTOR = '.figcenter, .figleft, .figright, figure';

/** In-chapter contents headings whose following link list is dropped. */
const CONTENTS_TITLES = new Set(['contents', 'table of contents']);

/** Minimal structural shape of parsed DOM nodes (domhandler-compatible). */
type DomNode = {
  type: string;
  data?: string;
  tagName?: string;
  nextSibling: DomNode | null;
};

/** True for nodes that carry no reading content (br/hr/whitespace/empty). */
function isEmptyPlaceholder($el: cheerio.Cheerio<never>): boolean {
  const el = $el.get(0) as DomNode | undefined;
  if (!el) return true;
  if (el.type === 'text') return !(el.data ?? '').trim();
  if (el.type !== 'tag') return true;
  const tag = (el.tagName ?? '').toLowerCase();
  if (tag === 'br' || tag === 'hr') return true;
  if (tag === 'img') return false;
  if (!$el.text().trim() && !$el.find('img').length) return true;
  return false;
}

/** True when an element carries no readable text and no images. */
function hasNoReadingContent($el: cheerio.Cheerio<never>): boolean {
  if ($el.is('img') || $el.find('img').length > 0) return false;
  return !$el
    .text()
    .replace(/\u00a0/g, ' ')
    .trim();
}

/**
 * Gutenberg spacer: `pg_body_wrapper` (and similar) that only holds `<br>` /
 * whitespace after figure stubs were removed.
 */
function isSpacerShell($el: cheerio.Cheerio<never>): boolean {
  const el = $el.get(0) as DomNode | undefined;
  if (!el || el.type !== 'tag') return false;
  const tag = (el.tagName ?? '').toLowerCase();
  if (tag !== 'div' && tag !== 'span' && tag !== 'p' && tag !== 'section') return false;
  if (!hasNoReadingContent($el)) return false;
  const cls = String($el.attr('class') ?? '').toLowerCase();
  if (cls.includes('pg_body_wrapper') || cls.includes('pg-body-wrapper')) return true;
  let onlyBreaks = true;
  $el.contents().each((_, child) => {
    const node = child as DomNode;
    if (node.type === 'text') {
      if ((node.data ?? '').trim()) onlyBreaks = false;
      return;
    }
    if (node.type === 'tag') {
      const childTag = (node.tagName ?? '').toLowerCase();
      if (childTag !== 'br' && childTag !== 'hr') onlyBreaks = false;
    }
  });
  return onlyBreaks;
}

/** True for a table-of-contents link block (class*="toc"). */
function isTocBlock($el: cheerio.Cheerio<never>): boolean {
  const cls = String($el.attr('class') ?? '').toLowerCase();
  return cls.includes('toc');
}

/**
 * Drop Gutenberg noimages stubs and empty image shells. Ebookmaker converts
 * missing `<img>` into `<span id="img_{src}">alt</span>`; leaving those as
 * linked captions looks like a product bug during immersive reading.
 */
export function removeNonDisplayableFigures($: cheerio.CheerioAPI): void {
  $('span[id^="img_"]').each((_, el) => {
    const $span = $(el);
    const $shell = $span.closest(FIGURE_SHELL_SELECTOR);
    if ($shell.length) {
      $shell.remove();
      return;
    }
    const $parent = $span.parent();
    if ($parent.is('a') && !$parent.attr('href') && $parent.children().length === 1) {
      $parent.remove();
      return;
    }
    $span.remove();
  });

  $('img').each((_, el) => {
    const $img = $(el);
    const src = ($img.attr('src') ?? '').trim();
    if (!src) {
      removeImgOrFigureShell($, $img as cheerio.Cheerio<never>);
    }
  });
}

/**
 * Strip empty reading chrome left after figure-stub removal: br-only wrappers
 * anywhere, plus leading decorative `<hr>` / spacers before the first real
 * heading or paragraph so chapters do not open with a blank band.
 */
export function removeEmptyReadingChrome($: cheerio.CheerioAPI): void {
  $('div.pg_body_wrapper, div.pg-body-wrapper').each((_, el) => {
    const $el = $(el) as cheerio.Cheerio<never>;
    if (isSpacerShell($el)) $el.remove();
  });

  $('div, p').each((_, el) => {
    const $el = $(el) as cheerio.Cheerio<never>;
    if (!$el.parent().length) return;
    if (isSpacerShell($el)) $el.remove();
  });

  const children = $('body').length > 0 ? $('body').children().toArray() : $.root().children().toArray();
  for (const child of children) {
    const $child = $(child) as cheerio.Cheerio<never>;
    const tag = (((child as DomNode).tagName ?? '') as string).toLowerCase();

    if (tag === 'hr') {
      $child.remove();
      continue;
    }
    if (isSpacerShell($child) || isEmptyPlaceholder($child)) {
      $child.remove();
      continue;
    }
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') break;
    if (tag === 'p' && $child.text().trim()) break;
    if ($child.find('h1, h2, h3, img').length > 0) break;
    if ($child.text().trim() && !isSpacerShell($child)) break;
    if (hasNoReadingContent($child)) {
      $child.remove();
      continue;
    }
    break;
  }
}

/**
 * Drop in-chapter contents pages: an h2/h3 whose text is exactly
 * CONTENTS / TABLE OF CONTENTS, plus the toc link blocks that follow it.
 */
export function removeContentsBlocks($: cheerio.CheerioAPI): void {
  $('h2, h3').each((_, el) => {
    const $h = $(el);
    const text = $h.text().replace(/\s+/g, ' ').trim().toLowerCase();
    if (!CONTENTS_TITLES.has(text)) return;

    const toRemove = [el];
    let node = (el as unknown as DomNode).nextSibling;
    while (node) {
      const $node = $(node as never);
      if (isEmptyPlaceholder($node)) {
        node = node.nextSibling;
        continue;
      }
      if (isTocBlock($node)) {
        toRemove.push(node as never);
        node = node.nextSibling;
        continue;
      }
      break;
    }
    for (const target of toRemove) {
      $(target).remove();
    }
  });
}
