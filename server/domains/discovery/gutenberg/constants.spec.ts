import { describe, expect, it } from 'vitest';

import {
  isGutenbergCatalogPlaceholderCover,
  projectGutenbergCoverUrl,
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
