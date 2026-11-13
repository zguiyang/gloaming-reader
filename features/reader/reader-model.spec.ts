import { describe, expect, it } from 'vitest';

import type { PartSummary } from '@/shared/works';

import { resolveReaderInternalLink } from '@/features/reader/reader-model';

function part(id: string, hrefs: string[], anchors: string[]): PartSummary {
  return {
    id,
    workId: 'work-1',
    sortOrder: 0,
    kind: 'chapter',
    title: id,
    wordCount: 1,
    estimatedMinutes: 1,
    sourceHref: hrefs[0] ?? null,
    sourceHrefs: hrefs,
    sourceAnchors: anchors,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as PartSummary;
}

const parts = [
  part('part-1', ['OEBPS/ch1.xhtml'], ['toc', 'intro']),
  part('part-2', ['OEBPS/ch2.xhtml'], ['toc', 'notes']),
];

describe('resolveReaderInternalLink', () => {
  it('keeps a same-document `#fragment` in the part being read', () => {
    // Ids like `toc` recur across chapters; searching from the front of the list
    // used to jump back to an earlier chapter instead of staying put.
    expect(resolveReaderInternalLink(parts, 'part-2', '#toc')).toEqual({ partId: 'part-2', fragment: 'toc' });
    expect(resolveReaderInternalLink(parts, 'part-2', '#notes')).toEqual({ partId: 'part-2', fragment: 'notes' });
  });

  it('falls back to another part when the anchor is not local', () => {
    expect(resolveReaderInternalLink(parts, 'part-2', '#intro')).toEqual({ partId: 'part-1', fragment: 'intro' });
  });

  it('returns null for an unknown anchor', () => {
    expect(resolveReaderInternalLink(parts, 'part-2', '#nowhere')).toBeNull();
  });

  it('resolves a relative file link against the current part directory', () => {
    expect(resolveReaderInternalLink(parts, 'part-1', 'ch2.xhtml#notes')).toEqual({
      partId: 'part-2',
      fragment: 'notes',
    });
    expect(resolveReaderInternalLink(parts, 'part-1', 'ch2.xhtml')).toEqual({
      partId: 'part-2',
      fragment: null,
    });
  });

  it('resolves an absolute container path', () => {
    expect(resolveReaderInternalLink(parts, 'part-1', '/OEBPS/ch2.xhtml#notes')).toEqual({
      partId: 'part-2',
      fragment: 'notes',
    });
  });

  it('collapses `..` segments in relative paths', () => {
    expect(resolveReaderInternalLink(parts, 'part-1', '../OEBPS/ch2.xhtml')).toEqual({
      partId: 'part-2',
      fragment: null,
    });
  });

  it('returns null for a file that is not part of the spine', () => {
    expect(resolveReaderInternalLink(parts, 'part-1', 'missing.xhtml')).toBeNull();
  });
});
