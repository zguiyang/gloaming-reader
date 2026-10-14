import { describe, expect, it } from 'vitest';

import {
  isEpubUploadFileName,
  parseGutenbergExternalId,
} from '@/domains/discovery/gutenberg/single-record';

describe('parseGutenbergExternalId', () => {
  it('accepts a plain positive numeric id', () => {
    expect(parseGutenbergExternalId('11339')).toBe('11339');
    expect(parseGutenbergExternalId(' 1342 ')).toBe('1342');
  });

  it('strips leading zeros to the canonical id', () => {
    expect(parseGutenbergExternalId('011339')).toBe('11339');
  });

  it('rejects non-numeric, empty, zero, and overlong values', () => {
    expect(parseGutenbergExternalId('pg11339')).toBeNull();
    expect(parseGutenbergExternalId('11339.epub')).toBeNull();
    expect(parseGutenbergExternalId('')).toBeNull();
    expect(parseGutenbergExternalId('   ')).toBeNull();
    expect(parseGutenbergExternalId('0')).toBeNull();
    expect(parseGutenbergExternalId('000')).toBeNull();
    expect(parseGutenbergExternalId('12345678901')).toBeNull();
  });
});

describe('isEpubUploadFileName', () => {
  it('accepts any name ending in .epub, case-insensitively', () => {
    expect(isEpubUploadFileName('pg11339.epub')).toBe(true);
    expect(isEpubUploadFileName('Aesop-s Fables.EPUB')).toBe(true);
    expect(isEpubUploadFileName('sample.Epub')).toBe(true);
    expect(isEpubUploadFileName('anything.epub')).toBe(true);
  });

  it('rejects names without the .epub suffix', () => {
    expect(isEpubUploadFileName('pg11339.epub.images')).toBe(false);
    expect(isEpubUploadFileName('pg11339')).toBe(false);
    expect(isEpubUploadFileName('epub')).toBe(false);
    expect(isEpubUploadFileName('')).toBe(false);
  });
});
