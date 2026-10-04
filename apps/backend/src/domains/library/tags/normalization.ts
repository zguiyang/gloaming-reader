/** Normalize a private User Tag name for per-user uniqueness. */
export function normalizeTagName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalized || value.toLowerCase().trim();
}
