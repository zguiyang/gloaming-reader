/**
 * Weak-value heuristics for AI-backfill eligibility.
 * Values that are empty, too short, generic, or shouty count as "weak" and
 * become fill targets (provenance=ai) — real hand-edited values never do.
 */

const GENERIC_DESCRIPTION_WORDS = new Set([
  'book',
  'story',
  'novel',
  'fiction',
  'a book',
  'this book',
  'the book',
  'about',
  'story about',
]);

export function isShouty(value: string): boolean {
  const letters = value.replace(/[^a-z]/gi, '');
  if (letters.length < 4) return false;
  const upper = value.replace(/[^A-Z]/g, '');
  return upper.length / letters.length > 0.8;
}

export function isGenericDescription(value: string): boolean {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
  if (GENERIC_DESCRIPTION_WORDS.has(normalized)) return true;
  return GENERIC_DESCRIPTION_WORDS.has(normalized.replace(/[.,;:!?]+$/, ''));
}

/** A description is weak when too short to be useful or trivially generic. */
export function isWeakDescription(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length < 80) return true;
  if (isShouty(trimmed)) return true;
  return isGenericDescription(trimmed);
}

/** Single-field weak check used by the field registry. */
export function isWeakFieldValue(value: string | undefined): boolean {
  if (!value || !value.trim()) return true;
  return isWeakDescription(value);
}
