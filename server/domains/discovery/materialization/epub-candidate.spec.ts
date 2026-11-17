import { describe, expect, it } from 'vitest';

import {
  isOfficialGutenbergEpubUrl,
  resolveGutenbergEpubDownloadUrl,
  selectGutenbergEpubCandidate,
} from '@/server/domains/discovery/materialization/epub-candidate';

describe('isOfficialGutenbergEpubUrl', () => {
  it('accepts www and PGLAF official EPUB paths', () => {
    for (const url of [
      'https://www.gutenberg.org/ebooks/1342.epub.images',
      'https://www.gutenberg.org/cache/epub/1342/pg1342-images.epub',
      'https://gutenberg.pglaf.org/cache/epub/1342/pg1342-images.epub',
      'https://gutenberg.pglaf.org/cache/epub/11/pg11.epub.noimages',
    ]) {
      expect(isOfficialGutenbergEpubUrl(url)).toBe(true);
    }
  });

  it('rejects non-official hosts and paths', () => {
    expect(isOfficialGutenbergEpubUrl('https://cdn.example/cache/epub/11/pg11-images.epub')).toBe(false);
    expect(isOfficialGutenbergEpubUrl('https://gutenberg.pglaf.org/ebooks/11.html')).toBe(false);
  });
});

describe('resolveGutenbergEpubDownloadUrl', () => {
  it('rewrites www /ebooks images convenience URLs onto the PGLAF cache object', () => {
    expect(resolveGutenbergEpubDownloadUrl('https://www.gutenberg.org/ebooks/79945.epub.images')).toBe(
      'https://gutenberg.pglaf.org/cache/epub/79945/pg79945-images.epub',
    );
  });

  it('leaves canonical mirror cache URLs unchanged', () => {
    const url = 'https://gutenberg.pglaf.org/cache/epub/11/pg11-images.epub';
    expect(resolveGutenbergEpubDownloadUrl(url)).toBe(url);
  });
});

describe('selectGutenbergEpubCandidate', () => {
  it('still selects stored www convenience URLs', () => {
    const selected = selectGutenbergEpubCandidate({
      contentCandidates: [
        {
          format: 'epub',
          url: 'https://www.gutenberg.org/ebooks/11.epub.images',
          mimeType: 'application/epub+zip',
        },
      ],
    });
    expect(selected.url).toBe('https://www.gutenberg.org/ebooks/11.epub.images');
  });
});
