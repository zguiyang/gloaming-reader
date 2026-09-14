import { isStopwordTag } from '@/modules/metadata-enrich/quality';

/** Align with AI tag cap — product tags from EPUB subjects stay concise. */
export const PRODUCT_TAG_MAX_LEN = 40 as const;
/** Maximum rule-derived candidates passed to AI; this is not the final tag cap. */
export const RULE_TAG_CANDIDATE_MAX_ITEMS = 12 as const;

/** LCSH-style subdivision heads that are never product tags on their own. */
const SUBDIVISION_ONLY = /^(translations?\s+into|juvenile\s+literature)\b/i;

/**
 * True when a string looks like bibliographic cataloging (LCSH etc.), not a
 * bookstore-style product tag. Used both to reject raw subjects and to treat
 * already-stored tags as weak for AI overwrite.
 */
export function isCatalogLikeTag(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > PRODUCT_TAG_MAX_LEN) return true;
  if (/\s--\s|--/.test(trimmed)) return true;
  if (/translations?\s+into/i.test(trimmed)) return true;
  return false;
}

/**
 * Rule layer: EPUB `dc:subject` → short candidate names for AI review.
 * Keeps LCSH heads (split on `--`, then `,`); drops subdivisions / stopwords /
 * overlong strings. These candidates never become final tags by themselves.
 */
export function cleanSubjectsToProductTags(subjects: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const subject of subjects) {
    const head = (subject.split(/\s*--\s*/)[0] ?? '').trim();
    if (!head) continue;
    for (const part of head.split(',')) {
      const name = part.replace(/\s+/g, ' ').trim();
      if (!name || name.length > PRODUCT_TAG_MAX_LEN) continue;
      if (isStopwordTag(name) || SUBDIVISION_ONLY.test(name) || isCatalogLikeTag(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= RULE_TAG_CANDIDATE_MAX_ITEMS) return out;
    }
  }
  return out;
}

/** Empty or any catalog-like name → weak (AI may overwrite product tags). */
export function areProductTagsWeak(tags: string[]): boolean {
  if (tags.length === 0) return true;
  return tags.some((tag) => isCatalogLikeTag(tag));
}
