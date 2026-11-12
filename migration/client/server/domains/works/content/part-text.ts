import * as cheerio from 'cheerio';

/**
 * SSOT for turning normalized reading HTML into plain text.
 * Every text consumer (TTS, translate, assist, content hash) goes through
 * these functions so offsets and caches stay consistent.
 */

/** Block-level elements that separate paragraphs in the extracted text. */
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

/** Structural shape of domhandler nodes we traverse (cheerio-internal). */
type WalkNode = {
  type: string;
  data?: string;
  tagName?: string;
  children: WalkNode[];
};

/** Append inline text to the current line (or start a new one). */
function appendText(lines: string[], raw: string): void {
  const cleaned = raw.replace(/\s+/g, ' ');
  if (!cleaned.trim()) return;
  const last = lines.length - 1;
  if (last >= 0 && lines[last] !== '') {
    lines[last] += cleaned;
  } else {
    lines.push(cleaned);
  }
}

/** Separate blocks with an empty line (no-op when already separated). */
function blockBreak(lines: string[]): void {
  if (lines.length > 0 && lines[lines.length - 1] !== '') {
    lines.push('');
  }
}

/**
 * Extract reading text from normalized HTML. Block elements become paragraph
 * breaks (`\n\n`); images and footnote markers (sup/sub) drop out entirely.
 */
export function htmlToPlainText(html: string): string {
  const $ = cheerio.load(html, null, false);
  const lines: string[] = [];

  const walk = (node: WalkNode): void => {
    if (node.type === 'text') {
      appendText(lines, node.data ?? '');
      return;
    }
    if (node.type !== 'tag') return;
    const tag = (node.tagName ?? '').toLowerCase();
    if (tag === 'img' || tag === 'sup' || tag === 'sub') return;
    if (tag === 'br') {
      blockBreak(lines);
      return;
    }
    if (BLOCK_TAGS.has(tag)) {
      blockBreak(lines);
    }
    for (const child of node.children) {
      walk(child);
    }
  };

  const root = $.root().get(0);
  if (root) {
    for (const child of root.children) {
      walk(child as unknown as WalkNode);
    }
  }

  return lines
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Collapse whitespace for TTS / prompt text (single-line normalize). */
export function normalizePartText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Plain text of a part body with normalized whitespace (title is metadata-only). */
export function partPlainText(bodyHtml: string): string {
  return normalizePartText(htmlToPlainText(bodyHtml));
}
