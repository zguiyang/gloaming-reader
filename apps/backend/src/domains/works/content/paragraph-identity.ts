import * as cheerio from 'cheerio';

/**
 * ReadingPart body paragraph ordinals (`data-p` on leaf block elements).
 * Leaf-block-only numbering keeps reader / TTS / translate anchors 1:1 with
 * readable paragraphs; wrappers that only contain other blocks are skipped.
 */

/** Block-level elements that receive a data-p ordinal. */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'pre',
  'figure',
  'section',
  'table',
  'dl',
  'address',
]);

const BLOCK_SELECTOR = [...BLOCK_TAGS].join(',');

/** True when this block has no nested block-level descendants (leaf reading unit). */
function isLeafReadingBlock($el: cheerio.Cheerio<never>): boolean {
  return $el.find(BLOCK_SELECTOR).length === 0;
}

function shouldSkipEmptyBlock($el: cheerio.Cheerio<never>): boolean {
  return $el.children().length === 0 && !$el.text().trim() && !($el.is('img') || $el.is('br') || $el.is('hr'));
}

/** Inject unique data-p ordinals on leaf block elements (document order). */
export function assignLeafParagraphOrdinals($: cheerio.CheerioAPI): void {
  let paragraphIndex = 0;
  $(BLOCK_SELECTOR).each((_, el) => {
    const $el = $(el) as cheerio.Cheerio<never>;
    if (shouldSkipEmptyBlock($el) || !isLeafReadingBlock($el)) {
      return;
    }
    $el.attr('data-p', String(paragraphIndex));
    paragraphIndex += 1;
  });
}

/**
 * Strip any existing data-p and assign unique leaf ordinals.
 * SSOT for paragraph identity after spine merges and for stored bodies that
 * still carry per-file / nested duplicate ordinals.
 */
export function reindexLeafParagraphOrdinals(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return html;
  }
  const $ = cheerio.load(trimmed, null, false);
  $('[data-p]').removeAttr('data-p');
  assignLeafParagraphOrdinals($);
  return ($.root().html() ?? trimmed).trim();
}
