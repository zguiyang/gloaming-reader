/** Canonical Unicode normalization for per-user name uniqueness; punctuation remains significant. */
export function normalizeTagName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');
}
