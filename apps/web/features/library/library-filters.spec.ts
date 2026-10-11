import { describe, expect, it } from 'vitest';

import {
  buildLibraryFilterQuery,
  mayBeTruncated,
  normalizeLibraryFilterSearch,
  parseLibraryFilters,
  resolveLibraryReturnTo,
} from '@/features/library/library-filters';

function params(search: string) {
  return new URLSearchParams(search);
}

describe('library filters', () => {
  it('parses source values and validates the tag against loaded user tags', () => {
    expect(parseLibraryFilters(params('source=personal&tag=tag-a'), ['tag-a'])).toEqual({
      source: 'personal',
      tagId: 'tag-a',
    });
    expect(parseLibraryFilters(params('source=saved'), ['tag-a'])).toEqual({ source: 'saved', tagId: null });
    // Legacy internal value keeps normalizing to the user-facing group.
    expect(parseLibraryFilters(params('source=saved_catalog'), null).source).toBe('saved');
    // Unknown source falls back to all; unknown tag is dropped.
    expect(parseLibraryFilters(params('source=other&tag=missing'), ['tag-a'])).toEqual({
      source: 'all',
      tagId: null,
    });
    // Tags not loaded yet keep the raw tag for optimistic restore.
    expect(parseLibraryFilters(params('tag=tag-a'), null)).toEqual({ source: 'all', tagId: 'tag-a' });
    expect(parseLibraryFilters(params('tag='), ['tag-a'])).toEqual({ source: 'all', tagId: null });
    expect(parseLibraryFilters(null)).toEqual({ source: 'all', tagId: null });
  });

  it('serializes only non-default filters', () => {
    expect(buildLibraryFilterQuery({ source: 'all', tagId: null })).toBe('');
    expect(buildLibraryFilterQuery({ source: 'personal', tagId: null })).toBe('source=personal');
    expect(buildLibraryFilterQuery({ source: 'all', tagId: 'tag-a' })).toBe('tag=tag-a');
    expect(buildLibraryFilterQuery({ source: 'saved', tagId: 'tag-a' })).toBe('source=saved&tag=tag-a');
  });

  it('flags only invalid or redundant URL parameters for normalization', () => {
    expect(normalizeLibraryFilterSearch({ source: 'all', tagId: null }, params(''), [])).toBeNull();
    expect(normalizeLibraryFilterSearch({ source: 'personal', tagId: null }, params('source=personal'), [])).toBeNull();
    expect(normalizeLibraryFilterSearch({ source: 'all', tagId: 'tag-a' }, params('tag=tag-a'), ['tag-a'])).toBeNull();
    expect(normalizeLibraryFilterSearch({ source: 'all', tagId: null }, params('source=bogus'), [])).toBe('');
    expect(normalizeLibraryFilterSearch({ source: 'all', tagId: null }, params('source=all'), [])).toBe('');
    expect(normalizeLibraryFilterSearch({ source: 'all', tagId: null }, params('tag=missing'), [])).toBe('');
    // Unknown unrelated params are left alone, even while normalizing a filter.
    expect(normalizeLibraryFilterSearch({ source: 'all', tagId: null }, params('utm=x'), [])).toBeNull();
    expect(normalizeLibraryFilterSearch({ source: 'all', tagId: null }, params('utm=x&source=all'), [])).toBe('utm=x');
  });

  it('treats a capped Library list as possibly truncated', () => {
    expect(mayBeTruncated(0)).toBe(false);
    expect(mayBeTruncated(47)).toBe(false);
    expect(mayBeTruncated(48)).toBe(true);
  });

  it('accepts only in-app Library return targets', () => {
    expect(resolveLibraryReturnTo('/library?source=personal&tag=tag-a')).toBe('/library?source=personal&tag=tag-a');
    expect(resolveLibraryReturnTo('/library')).toBe('/library');
    expect(resolveLibraryReturnTo('https://evil.example/library')).toBe('/library');
    expect(resolveLibraryReturnTo('//evil.example/library')).toBe('/library');
    expect(resolveLibraryReturnTo('/library-tags')).toBe('/library');
    expect(resolveLibraryReturnTo('/reading-history')).toBe('/library');
    expect(resolveLibraryReturnTo('/library#frag')).toBe('/library');
    expect(resolveLibraryReturnTo(undefined)).toBe('/library');
  });
});
