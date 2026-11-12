/** Content helpers that are not cover presentation. */

export function paragraphsFromBody(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}
