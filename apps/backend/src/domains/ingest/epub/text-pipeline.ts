/**
 * Text pipeline — port of textstack's stable processors (Whitespace / Entity /
 * EmptyTag) from its ProcessingPipeline. Runs on the serialized reading HTML.
 * Typography / spelling / semantic processors are intentionally not ported:
 * they rewrite text or add markup and trade stability for polish.
 */

const TRAILING_SPACE_EOL = /[ \t]+\n/g;
const MULTIPLE_BLANK_LINES = /\n{3,}/g;
const MULTIPLE_SPACES = /[ \t]{2,}/g;
const SPACE_BEFORE_CLOSE_TAG = /\s+<\/(\w+)>/g;
const SPACE_AFTER_OPEN_TAG = /<(\w+[^>]*)>\s+/g;
const SPACE_BEFORE_PUNCTUATION = /\s+([.,;:!?])/g;

const EMPTY_TAG = /<([a-z][a-z0-9]*)(?:\s+[^>]*)?>\s*<\/\1>/gi;
const SELF_CLOSING_EMPTY_TAG = /<([a-z][a-z0-9]*)\s*\/>/gi;

/** Tags whose empty form adds no value and may be dropped. */
const REMOVABLE_EMPTY_TAGS = new Set([
  'span',
  'p',
  'div',
  'em',
  'i',
  'b',
  'strong',
  'u',
  's',
  'strike',
  'a',
  'font',
  'center',
  'blockquote',
]);

/** Tags that stay even when "empty" (void, media or structural). */
const PRESERVED_EMPTY_TAGS = new Set([
  'br',
  'hr',
  'img',
  'input',
  'meta',
  'link',
  'area',
  'base',
  'col',
  'embed',
  'param',
  'source',
  'track',
  'wbr',
  'td',
  'th',
  'tr',
  'tbody',
  'thead',
  'tfoot',
  'table',
  'iframe',
  'video',
  'audio',
  'canvas',
  'svg',
  'object',
]);

/** Collapse line endings, trailing spaces, blank lines and tag-adjacent spaces. */
export function normalizeWhitespace(html: string): string {
  let out = html.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  out = out.replace(TRAILING_SPACE_EOL, '\n');
  out = out.replace(MULTIPLE_BLANK_LINES, '\n\n');
  out = out.replace(MULTIPLE_SPACES, ' ');
  out = out.replace(SPACE_BEFORE_CLOSE_TAG, '</$1>');
  out = out.replace(SPACE_AFTER_OPEN_TAG, '<$1>');
  out = out.replace(SPACE_BEFORE_PUNCTUATION, '$1');
  return out.trim();
}

/** Fix double-encoded entities (e.g. `&amp;amp;` → `&amp;`) until stable. */
export function fixDoubleEncodedEntities(html: string): string {
  let out = html;
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(/&amp;([a-zA-Z][a-zA-Z0-9]*;)/g, '&$1').replace(/&amp;(#[0-9a-fA-F]+;)/g, '&$1');
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Drop empty removable tags (iterated until stable). */
export function removeEmptyTags(html: string): string {
  let out = html;
  for (let i = 0; i < 10; i += 1) {
    const next = out
      .replace(EMPTY_TAG, (match, tag: string) => (REMOVABLE_EMPTY_TAGS.has(tag.toLowerCase()) ? '' : match))
      .replace(SELF_CLOSING_EMPTY_TAG, (match, tag: string) => {
        const name = tag.toLowerCase();
        if (PRESERVED_EMPTY_TAGS.has(name) || !REMOVABLE_EMPTY_TAGS.has(name)) return match;
        return '';
      });
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Full pipeline — order matches textstack (whitespace → entities → empty tags). */
export function applyTextPipeline(html: string): string {
  return removeEmptyTags(fixDoubleEncodedEntities(normalizeWhitespace(html)));
}
