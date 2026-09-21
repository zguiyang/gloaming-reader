import type * as cheerio from 'cheerio';

/** Tags removed entirely with their subtree (textstack DangerousTags + head). */
const DANGEROUS_TAGS = new Set([
  'head',
  'script',
  'style',
  'link',
  'iframe',
  'object',
  'embed',
  'base',
  'form',
  'meta',
  'noscript',
  'frame',
  'frameset',
  'applet',
]);

/** URL-bearing attributes scrubbed with the same scheme allowlist as href. */
const URL_ATTRS = ['href', 'src', 'srcset', 'data', 'action', 'formaction', 'poster', 'background', 'xlink:href'];

const DANGEROUS_SCHEME = /^(javascript|vbscript|file|blob):/i;

/** Self-closing tag names — the only ones allowed to keep `/>` form. */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Repair self-closing non-void tags. HTML5 parsing ignores `/>` on non-void
 * elements, so `<title/>` (and `<div/>` etc.) would swallow everything until
 * its closing tag — parse5 then loses the whole body.
 */
export function fixSelfClosingTags(html: string): string {
  return html.replace(/<([a-z][a-z0-9]*)(\s[^>]*)?\/>/gi, (match, tag: string, attrs: string | undefined) => {
    if (VOID_TAGS.has(tag.toLowerCase())) return match;
    return `<${tag}${attrs ?? ''}></${tag}>`;
  });
}

/**
 * Scheme allowlist for URL attributes (textstack SanitizeUrl): entities are
 * already decoded by the parser and control characters stripped before
 * matching. Returns the value unchanged when safe, a `#`-anchor downgrade for
 * dangerous hrefs, or null to remove the attribute.
 */
function sanitizeUrl(attrName: string, value: string): string | null {
  const collapsed = value.replace(/[\t\n\r\f\0 ]/g, '');
  const firstUrl = attrName === 'srcset' ? collapsed.split(',')[0]!.split(' ')[0]! : collapsed;
  const lower = firstUrl.toLowerCase();
  const isNavigational = attrName === 'href' || attrName === 'xlink:href';
  const dataImageOk = lower.startsWith('data:image/') && !isNavigational && !lower.startsWith('data:image/svg');
  const unsafe = DANGEROUS_SCHEME.test(lower) || (lower.startsWith('data:') && !dataImageOk);
  if (!unsafe) return value;
  if (isNavigational) {
    const hashIndex = value.indexOf('#');
    return hashIndex >= 0 ? value.slice(hashIndex) : '#';
  }
  return null;
}

export function scrubAttributes($: cheerio.CheerioAPI): void {
  $('*').each((_, el) => {
    if (el.type !== 'tag') return;
    const $el = $(el);
    for (const attr of Object.keys(el.attribs ?? {})) {
      const name = attr.toLowerCase();
      if (name.startsWith('on')) {
        $el.removeAttr(attr);
        continue;
      }
      if (URL_ATTRS.includes(name)) {
        const value = $el.attr(attr) ?? '';
        if (!value) continue;
        const sanitized = sanitizeUrl(name, value);
        if (sanitized === null) {
          $el.removeAttr(attr);
        } else if (sanitized !== value) {
          $el.attr(attr, sanitized);
        }
      }
    }
  });
}

export function removeDangerousTags($: cheerio.CheerioAPI): void {
  $([...DANGEROUS_TAGS].join(',')).remove();
}
