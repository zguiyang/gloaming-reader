/**
 * Canonical form for tag/category dedupe — lowercase, strip punctuation and
 * whitespace. Mirrors the SQL normalization in the 0017 data migration so the
 * DB unique constraint and runtime upserts agree.
 */
export function normalizeTag(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalized || value.toLowerCase().trim();
}
