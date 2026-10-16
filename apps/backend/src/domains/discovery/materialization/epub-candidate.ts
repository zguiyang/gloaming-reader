import type { SourceRecordContentCandidate } from '@gloaming/db/schema';

/**
 * Deterministic, side-effect-free EPUB candidate selection over *already-synced*
 * SourceRecord metadata. It never crawls, downloads, or resolves redirects; it
 * only ranks the `content_candidates` the metadata sync already stored.
 *
 * Preference (see `variantRank`), lowest rank wins:
 *   1. Standard EPUB (`epub`) before EPUB 3 (`epub3`).
 *   2. Within a version, `images` before `noimages` before a bare `.epub`.
 *   3. Final tie-break is the candidate URL, compared by code units, so the same
 *      metadata always selects the same candidate regardless of input order.
 */

/** Official Project Gutenberg content host; mirrors the metadata snapshot adapter. */
const GUTENBERG_HOSTNAME = 'www.gutenberg.org';

/**
 * Official Project Gutenberg EPUB content paths:
 *   /ebooks/{id}.epub[3][.images|.noimages]
 *   /cache/epub/{id}/pg{id}.epub[3][.images|.noimages]
 *   /cache/epub/{id}/pg{id}-images.epub (confirmed canonical images file)
 *   /files/{id}/[pg]{id}.epub[3][.images|.noimages]
 * Anything else (HTML, plain text, third-party hosts) is not an accepted candidate.
 */
const GUTENBERG_EPUB_PATH_PATTERN =
  /^\/(?:ebooks\/\d+|cache\/epub\/\d+\/pg\d+|files\/\d+\/(?:pg)?\d+)\.(?:epub|epub3)(?:\.(?:images|noimages))?$/;
const GUTENBERG_CANONICAL_IMAGES_PATH_PATTERN = /^\/cache\/epub\/(\d+)\/pg\1-images\.epub$/;

const EPUB_MIME_PATTERN = /epub/i;
const HTML_OR_TEXT_MIME_PATTERN = /^(?:text\/|application\/xhtml)/i;

/** Raised when synced metadata contains no acceptable official Gutenberg EPUB candidate. */
export class EpubCandidateSelectionError extends Error {
  readonly code = 'no_epub_candidate';

  constructor(message: string) {
    super(message);
    this.name = 'EpubCandidateSelectionError';
  }
}

/** Minimal synced-metadata view the selector needs; keeps it pure and DB-free. */
export type EpubCandidateSource = {
  readonly contentCandidates: readonly SourceRecordContentCandidate[];
};

/** True only for an `https://www.gutenberg.org/...` URL on an official EPUB content path. */
export function isOfficialGutenbergEpubUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== GUTENBERG_HOSTNAME) {
    return false;
  }
  return (
    GUTENBERG_EPUB_PATH_PATTERN.test(parsed.pathname) || GUTENBERG_CANONICAL_IMAGES_PATH_PATTERN.test(parsed.pathname)
  );
}

/**
 * True when a synced candidate is an official Gutenberg EPUB:
 * format label `epub`, an official Gutenberg EPUB URL, and (when present) a
 * non-HTML/non-text MIME type. HTML and plain text candidates are rejected.
 */
function isSelectableEpubCandidate(candidate: SourceRecordContentCandidate): boolean {
  if (candidate.format.trim().toLowerCase() !== 'epub') {
    return false;
  }
  if (!isOfficialGutenbergEpubUrl(candidate.url)) {
    return false;
  }
  const mimeType = candidate.mimeType?.trim();
  if (!mimeType) {
    return true;
  }
  if (HTML_OR_TEXT_MIME_PATTERN.test(mimeType)) {
    return false;
  }
  return EPUB_MIME_PATTERN.test(mimeType);
}

/** Lower is better: standard EPUB (`0`) before EPUB 3 (`1`). */
function versionRank(pathname: string): number {
  return /\.epub3(?:\.|$)/i.test(pathname) ? 1 : 0;
}

/** Lower is better: `images` (`0`), `noimages` (`1`), bare EPUB (`2`). */
function imageRank(pathname: string): number {
  if (/\.noimages$/i.test(pathname)) {
    return 1;
  }
  if (/\.images$/i.test(pathname) || /-images\.epub$/i.test(pathname)) {
    return 0;
  }
  return 2;
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Returns the single preferred official Gutenberg EPUB candidate from synced
 * metadata. Deterministic and order-independent. Throws
 * {@link EpubCandidateSelectionError} when nothing acceptable exists.
 */
export function selectGutenbergEpubCandidate(source: EpubCandidateSource): SourceRecordContentCandidate {
  const selectable = source.contentCandidates.filter(isSelectableEpubCandidate);
  if (selectable.length === 0) {
    throw new EpubCandidateSelectionError(
      `No official Project Gutenberg EPUB candidate in ${source.contentCandidates.length} synced content candidate(s)`,
    );
  }

  const ranked = selectable
    .map((candidate) => {
      const pathname = pathnameOf(candidate.url);
      return { candidate, version: versionRank(pathname), image: imageRank(pathname) };
    })
    .sort((a, b) => {
      if (a.version !== b.version) {
        return a.version - b.version;
      }
      if (a.image !== b.image) {
        return a.image - b.image;
      }
      if (a.candidate.url !== b.candidate.url) {
        return a.candidate.url < b.candidate.url ? -1 : 1;
      }
      return 0;
    });

  return ranked[0]!.candidate;
}
