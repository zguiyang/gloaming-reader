/**
 * Book title cleaning — port of textstack's BookTitleCleaner rules.
 * Real EPUB pipelines (O'Reilly Atlas / Calibre) leave template placeholders
 * and empty parens behind; we strip only provably-empty artifacts and keep
 * real parentheticals like "(2nd ed.)".
 */

const EMPTY = String.raw`[\s\p{Cf}]*`;

/** Tail "(for ...)" where inside is empty or a template placeholder. */
const EMPTY_FOR_PARENS = new RegExp(
  String.raw`[\s\p{Cf}]*\(` +
    EMPTY +
    String.raw`for\b(?:` +
    EMPTY +
    String.raw`(?:\$\{[^}]*\}|\{\{[^}]*\}\}|\$[A-Za-z_][\w.]*|%\w+))?` +
    EMPTY +
    String.raw`\)` +
    EMPTY +
    String.raw`$`,
  'i',
);

const EMPTY_TAIL_PARENS = new RegExp(String.raw`\s*\(\s*\)\s*$`);
const TEMPLATE_PLACEHOLDER = /\$\{[^}]*\}|\{\{[^}]*\}\}|\$[A-Za-z_][\w.]*/g;
const WORD_EXPORT_PREFIX = /^\s*microsoft\s+word\s*[-–—]\s*/i;
const FILE_EXT_SUFFIX = /\.(docx?|pdf|rtf|pages|odt)\s*$/i;
const COPY_SUFFIX = /\s+copy(\s+\d+(?:[.-]\d+)*)?\s*$/i;

export function cleanBookTitle(raw: string): string {
  let title = raw.replace(/\s+/g, ' ').trim();
  if (!title) return '';

  title = title.replace(EMPTY_FOR_PARENS, '');
  title = title.replace(EMPTY_TAIL_PARENS, '');
  title = title.replace(TEMPLATE_PLACEHOLDER, '');
  title = title.replace(WORD_EXPORT_PREFIX, '');
  title = title.replace(FILE_EXT_SUFFIX, '');
  title = title.replace(COPY_SUFFIX, '');
  return title.replace(/\s+/g, ' ').trim();
}

/** Join authors with ", " (textstack behavior). */
export function joinAuthors(authors: string[]): string {
  return authors.filter((a) => a.trim()).join(', ');
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    if (named !== undefined) return named;
    if (/^#x/i.test(entity)) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (/^#/.test(entity)) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return match;
  });
}

/** Strip HTML tags, decode entities, collapse whitespace — port of textstack's StripHtml. */
export function cleanDescription(raw: string): string {
  if (!raw) return '';
  return decodeHtmlEntities(raw)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
