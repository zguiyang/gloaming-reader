import { describe, expect, it } from 'vitest';

import { issuedToPopularityScore, parseGutenbergCsvCatalog } from '@/server/domains/discovery/gutenberg/csv-catalog';
import { projectGutenbergEpubImagesUrl } from '@/server/domains/discovery/gutenberg/constants';

const SAMPLE_CSV = `Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves
1,Text,1971-12-01,The Declaration of Independence of the United States of America,en,"Jefferson, Thomas, 1743-1826","United States -- History",E201,"Politics; American Revolutionary War"
2,Text,1972-12-01,"The United States Bill of Rights",en,"United States",Constitution,KF,Politics
3,Audio,2000-01-01,Some Audio Book,en,Someone,Topic,A,Shelf
4,Text,2020-06-15,Bilingual Sample,en;fr,"Author, Example",Subject,B,Shelf
`;

describe('parseGutenbergCsvCatalog', () => {
  it('keeps Text rows and synthesizes EPUB + cover candidates', () => {
    const entries = parseGutenbergCsvCatalog(SAMPLE_CSV);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.externalId)).toEqual(['1', '2', '4']);

    const first = entries[0]!;
    expect(first.title).toContain('Declaration');
    expect(first.authors[0]?.name).toContain('Jefferson');
    expect(first.languages).toEqual(['en']);
    expect(first.hasEpub).toBe(true);
    expect(first.contentCandidates[0]?.url).toBe(projectGutenbergEpubImagesUrl('1'));
    expect(first.sourceMeta.extra?.rankBasis).toBe('issued');
    expect(first.popularityScore).toBe(issuedToPopularityScore('1971-12-01'));
  });

  it('parses multi-language rows', () => {
    const bilingual = parseGutenbergCsvCatalog(SAMPLE_CSV).find((e) => e.externalId === '4');
    expect(bilingual?.languages).toEqual(['en', 'fr']);
    expect(bilingual?.popularityScore).toBeGreaterThan(issuedToPopularityScore('1971-12-01'));
  });

  it('rejects empty or header-only CSV', () => {
    expect(() => parseGutenbergCsvCatalog('')).toThrow(/empty/i);
    expect(() =>
      parseGutenbergCsvCatalog('Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves\n'),
    ).toThrow(/no Text/i);
  });
});

describe('issuedToPopularityScore', () => {
  it('orders newer issues above older ones', () => {
    expect(issuedToPopularityScore('2020-01-01')).toBeGreaterThan(issuedToPopularityScore('1971-12-01'));
    expect(issuedToPopularityScore(null)).toBe(0);
    expect(issuedToPopularityScore('not-a-date')).toBe(0);
  });
});
