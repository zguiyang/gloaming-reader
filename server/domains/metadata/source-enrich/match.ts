/** Normalize titles/authors for OPDS confidence matching. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^the\s+/u, '')
    .replace(/[^a-z0-9\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the work author string overlaps any candidate author name. */
export function authorsOverlap(workAuthor: string, candidateAuthors: readonly string[]): boolean {
  const workNorm = normalizeForMatch(workAuthor);
  if (!workNorm) return false;
  const workTokens = new Set(workNorm.split(' ').filter((token) => token.length > 1));
  for (const candidate of candidateAuthors) {
    const candidateNorm = normalizeForMatch(candidate);
    if (!candidateNorm) continue;
    if (workNorm === candidateNorm || workNorm.includes(candidateNorm) || candidateNorm.includes(workNorm)) {
      return true;
    }
    const candidateTokens = candidateNorm.split(' ').filter((token) => token.length > 1);
    if (candidateTokens.some((token) => workTokens.has(token))) {
      return true;
    }
  }
  return false;
}

export type MatchCandidate = {
  externalId: string;
  title: string;
  authors: readonly string[];
};

/**
 * Pick a single high-confidence OPDS hit: normalized title equal, and author
 * overlap when the work has an author. Zero or multiple survivors → miss.
 */
export function pickConfidentMatch(
  workTitle: string,
  workAuthor: string,
  candidates: readonly MatchCandidate[],
): MatchCandidate | null {
  const titleNorm = normalizeForMatch(workTitle);
  if (!titleNorm) return null;

  const titleHits = candidates.filter((candidate) => normalizeForMatch(candidate.title) === titleNorm);
  if (titleHits.length === 0) return null;

  const author = workAuthor.trim();
  if (!author) {
    return titleHits.length === 1 ? titleHits[0]! : null;
  }

  const authorHits = titleHits.filter((candidate) =>
    authorsOverlap(
      author,
      candidate.authors.map((item) => item),
    ),
  );
  return authorHits.length === 1 ? authorHits[0]! : null;
}

/** Empty or very short descriptions may be replaced by a source summary. */
export function isEmptyOrWeakDescription(value: string | null | undefined): boolean {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim();
  return trimmed.length < 40;
}
