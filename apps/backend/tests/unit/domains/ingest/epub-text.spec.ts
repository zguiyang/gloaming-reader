import { describe, expect, it } from 'vitest';

import { cleanBookTitle, joinAuthors } from '@/domains/ingest';
import { htmlToPlainText, normalizePartText } from '@/domains/works';
import { partPlainText } from '@/domains/works/content/part-text';

describe('cleanBookTitle', () => {
  it('strips empty "for" parentheticals with template placeholders', () => {
    expect(cleanBookTitle('Designing Data-Intensive Applications (for ${atlas.author_email})')).toBe(
      'Designing Data-Intensive Applications',
    );
  });

  it('keeps meaningful parentheticals', () => {
    expect(cleanBookTitle('The Book (2nd ed.)')).toBe('The Book (2nd ed.)');
  });

  it('strips Word export prefix and file extension suffixes', () => {
    expect(cleanBookTitle('Microsoft Word - Final Draft')).toBe('Final Draft');
    expect(cleanBookTitle('Report FINAL.docx')).toBe('Report FINAL');
  });

  it('strips copy markers', () => {
    expect(cleanBookTitle('Notes copy 5')).toBe('Notes');
  });
});

describe('joinAuthors', () => {
  it('joins with comma', () => {
    expect(joinAuthors(['Ada Lovelace', 'Grace Hopper'])).toBe('Ada Lovelace, Grace Hopper');
  });

  it('filters empties', () => {
    expect(joinAuthors(['', 'Only One'])).toBe('Only One');
  });
});

describe('htmlToPlainText', () => {
  it('extracts paragraphs with blank-line separation', () => {
    const text = htmlToPlainText(`<p>First para.</p><p>Second <em>para</em>.</p>`);
    expect(text).toBe('First para.\n\nSecond para.');
  });

  it('drops images and footnote markers', () => {
    const text = htmlToPlainText(`<p>Text<sup>1</sup>.</p><img src="/api/reader/assets/x"><p>After.</p>`);
    expect(text).toBe('Text.\n\nAfter.');
  });

  it('keeps heading text', () => {
    const text = htmlToPlainText(`<h2>Chapter 1</h2><p>Body.</p>`);
    expect(text).toBe('Chapter 1\n\nBody.');
  });

  it('normalizes whitespace within paragraphs', () => {
    const text = htmlToPlainText(`<p>Hello   world,\n  wide.</p>`);
    expect(text).toBe('Hello world, wide.');
  });
});

describe('normalizePartText / partPlainText', () => {
  it('collapses whitespace', () => {
    expect(normalizePartText('a\n\n b ')).toBe('a b');
  });

  it('returns normalized body plain text', () => {
    expect(partPlainText('<p>Body text.</p>')).toBe('Body text.');
  });
});
