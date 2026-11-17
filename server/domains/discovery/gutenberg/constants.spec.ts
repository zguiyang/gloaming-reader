import { describe, expect, it } from 'vitest';

import {
  isGutenbergCatalogPlaceholderCover,
  projectGutenbergCoverUrl,
  projectGutenbergEpubImagesUrl,
  rewriteGutenbergCoverUrlToMirror,
} from '@/server/domains/discovery/gutenberg/constants';

describe('isGutenbergCatalogPlaceholderCover', () => {
  it('rejects the shared search-feed dictionary icon', () => {
    expect(isGutenbergCatalogPlaceholderCover('https://dev.gutenberg.org/gutenberg/kdict.png')).toBe(true);
    expect(isGutenbergCatalogPlaceholderCover('https://www.gutenberg.org/gutenberg/kdict.png')).toBe(true);
    expect(isGutenbergCatalogPlaceholderCover('https://www.gutenberg.org/kdict.png?v=1')).toBe(true);
  });

  it('keeps real per-ebook cover URLs', () => {
    expect(isGutenbergCatalogPlaceholderCover(projectGutenbergCoverUrl('84'))).toBe(false);
    expect(isGutenbergCatalogPlaceholderCover('https://www.gutenberg.org/cache/epub/84/pg84.cover.small.jpg')).toBe(
      false,
    );
  });
});

describe('projectGutenbergCoverUrl', () => {
  it('points at the PGLAF cover mirror', () => {
    expect(projectGutenbergCoverUrl('84')).toBe('https://gutenberg.pglaf.org/cache/epub/84/pg84.cover.medium.jpg');
  });
});

describe('rewriteGutenbergCoverUrlToMirror', () => {
  it('rewrites www.gutenberg.org covers onto PGLAF', () => {
    expect(rewriteGutenbergCoverUrlToMirror('https://www.gutenberg.org/cache/epub/11/pg11.cover.medium.jpg')).toBe(
      'https://gutenberg.pglaf.org/cache/epub/11/pg11.cover.medium.jpg',
    );
  });

  it('leaves mirror and unrelated hosts unchanged', () => {
    const mirror = 'https://gutenberg.pglaf.org/cache/epub/11/pg11.cover.medium.jpg';
    expect(rewriteGutenbergCoverUrlToMirror(mirror)).toBe(mirror);
    expect(rewriteGutenbergCoverUrlToMirror('https://cdn.example/cover.jpg')).toBe('https://cdn.example/cover.jpg');
  });
});

describe('projectGutenbergEpubImagesUrl', () => {
  it('uses the PGLAF cache images EPUB path', () => {
    expect(projectGutenbergEpubImagesUrl('11')).toBe('https://gutenberg.pglaf.org/cache/epub/11/pg11-images.epub');
  });
});
