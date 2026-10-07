import { describe, expect, it } from 'vitest';

import type { SourceRecordContentCandidate } from '@gloaming/db/schema';

import {
  EpubCandidateSelectionError,
  type EpubCandidateSource,
  isOfficialGutenbergEpubUrl,
  selectGutenbergEpubCandidate,
} from '@/domains/discovery/materialization';

function candidate(url: string, overrides: Partial<SourceRecordContentCandidate> = {}): SourceRecordContentCandidate {
  return { format: 'epub', url, ...overrides };
}

function source(...candidates: SourceRecordContentCandidate[]): EpubCandidateSource {
  return { contentCandidates: candidates };
}

const EBOOKS = 'https://www.gutenberg.org/ebooks/1342';

describe('selectGutenbergEpubCandidate', () => {
  it('prefers standard EPUB over EPUB 3 and images over no-images', () => {
    const selected = selectGutenbergEpubCandidate(
      source(
        candidate(`${EBOOKS}.epub3.noimages`),
        candidate(`${EBOOKS}.epub.noimages`),
        candidate(`${EBOOKS}.epub3.images`),
        candidate(`${EBOOKS}.epub.images`),
      ),
    );

    expect(selected.url).toBe(`${EBOOKS}.epub.images`);
  });

  it('prefers images over no-images within the same EPUB version', () => {
    const selected = selectGutenbergEpubCandidate(
      source(candidate(`${EBOOKS}.epub.noimages`), candidate(`${EBOOKS}.epub.images`)),
    );

    expect(selected.url).toBe(`${EBOOKS}.epub.images`);
  });

  it('accepts a bare standard EPUB when no images variant exists', () => {
    const selected = selectGutenbergEpubCandidate(
      source(candidate(`${EBOOKS}.epub3.images`), candidate(`${EBOOKS}.epub`)),
    );

    expect(selected.url).toBe(`${EBOOKS}.epub`);
  });

  it('is order-independent for the same synced metadata', () => {
    const first = selectGutenbergEpubCandidate(
      source(
        candidate(`${EBOOKS}.epub.noimages`),
        candidate(`${EBOOKS}.epub.images`),
        candidate(`${EBOOKS}.epub3.images`),
      ),
    );
    const reversed = selectGutenbergEpubCandidate(
      source(
        candidate(`${EBOOKS}.epub3.images`),
        candidate(`${EBOOKS}.epub.images`),
        candidate(`${EBOOKS}.epub.noimages`),
      ),
    );

    expect(first.url).toBe(reversed.url);
    expect(first.url).toBe(`${EBOOKS}.epub.images`);
  });

  it('breaks ties by URL code-unit order', () => {
    const cache = 'https://www.gutenberg.org/cache/epub/1342/pg1342.epub.images';
    const ebooks = `${EBOOKS}.epub.images`;

    expect(selectGutenbergEpubCandidate(source(candidate(ebooks), candidate(cache))).url).toBe(cache);
    expect(selectGutenbergEpubCandidate(source(candidate(cache), candidate(ebooks))).url).toBe(cache);
  });

  it('accepts official cache and legacy files paths', () => {
    expect(
      selectGutenbergEpubCandidate(source(candidate('https://www.gutenberg.org/cache/epub/1342/pg1342.epub.noimages')))
        .url,
    ).toBe('https://www.gutenberg.org/cache/epub/1342/pg1342.epub.noimages');
    expect(selectGutenbergEpubCandidate(source(candidate('https://www.gutenberg.org/files/1342/1342.epub'))).url).toBe(
      'https://www.gutenberg.org/files/1342/1342.epub',
    );
  });

  it('ignores HTML, plain text, and non-official EPUB candidates', () => {
    expect(() =>
      selectGutenbergEpubCandidate(
        source(
          candidate(`${EBOOKS}.html.images`, { format: 'html', mimeType: 'text/html' }),
          candidate(`${EBOOKS}.txt.utf-8`, { format: 'txt', mimeType: 'text/plain' }),
          candidate(`${EBOOKS}.epub.images`, { mimeType: 'text/html' }),
          candidate('https://example.test/1342.epub.images'),
          candidate('http://www.gutenberg.org/ebooks/1342.epub.images'),
        ),
      ),
    ).toThrow(EpubCandidateSelectionError);
  });

  it('fails clearly when synced metadata has no candidates', () => {
    expect(() => selectGutenbergEpubCandidate(source())).toThrow(EpubCandidateSelectionError);
    expect(() => selectGutenbergEpubCandidate(source())).toThrow(/No official Project Gutenberg EPUB candidate/);
  });
});

describe('isOfficialGutenbergEpubUrl', () => {
  it('accepts official EPUB content URLs', () => {
    for (const url of [
      'https://www.gutenberg.org/ebooks/1342.epub',
      'https://www.gutenberg.org/ebooks/1342.epub.images',
      'https://www.gutenberg.org/ebooks/1342.epub3.noimages',
      'https://www.gutenberg.org/cache/epub/1342/pg1342.epub.images',
      'https://www.gutenberg.org/files/1342/1342.epub',
    ]) {
      expect(isOfficialGutenbergEpubUrl(url)).toBe(true);
    }
  });

  it('rejects non-EPUB, non-official, and malformed URLs', () => {
    for (const url of [
      'https://www.gutenberg.org/ebooks/1342.html.images',
      'https://www.gutenberg.org/ebooks/1342.txt.utf-8',
      'http://www.gutenberg.org/ebooks/1342.epub.images',
      'https://gutenberg.org/ebooks/1342.epub.images',
      'https://www.gutenberg.org.evil.test/ebooks/1342.epub.images',
      'not a url',
    ]) {
      expect(isOfficialGutenbergEpubUrl(url)).toBe(false);
    }
  });
});
