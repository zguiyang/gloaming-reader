import { describe, expect, it } from 'vitest';

import { planChapters, splitSingleFileByHeadings } from '@/modules/epub-ingest/chapters';
import { cleanXhtml } from '@/modules/epub-ingest/normalization/normalize-xhtml';
import type { EpubBook } from '@/modules/epub-ingest/types';

function book(entries: Array<[string, string]>): EpubBook {
  return {
    entries: new Map(entries.map(([k, v]) => [k, Buffer.from(v)])),
    opfPath: 'content.opf',
    title: 'T',
    authors: [],
    description: '',
    language: 'en',
    spine: entries.map(([href]) => ({ href, idref: href })),
    nav: [],
    coverHref: null,
    coverMime: null,
  };
}

function clean(href: string, rawHtml: string) {
  return cleanXhtml(rawHtml, () => '');
}

describe('planChapters', () => {
  it('uses nav titles and keeps front/back matter titled by type (textstack)', () => {
    const b = book([
      ['contents.xhtml', '<html><body><h1>Contents</h1><p>list</p></body></html>'],
      ['copyright.xhtml', '<html><body><h1>Copyright</h1><p>2026</p></body></html>'],
      ['ch1.xhtml', '<html><body><h1>Chapter 1</h1><p>One.</p></body></html>'],
      ['ack.xhtml', '<html><body><h1>Acknowledgments</h1><p>Thanks.</p></body></html>'],
      ['appendix.xhtml', '<html><body><h1>Appendix</h1><p>Extra.</p></body></html>'],
    ]);
    b.nav = [
      { label: 'Contents', href: 'contents.xhtml', depth: 1 },
      { label: 'Copyright', href: 'copyright.xhtml', depth: 1 },
      { label: 'Chapter 1', href: 'ch1.xhtml', depth: 1 },
      { label: 'Acknowledgments', href: 'ack.xhtml', depth: 1 },
      { label: 'Appendix', href: 'appendix.xhtml', depth: 1 },
    ];

    const chapters = planChapters(b, clean);
    expect(chapters.map((c) => c.title)).toEqual(['Contents', 'Copyright', 'Chapter 1', 'Acknowledgments', 'Appendix']);
  });

  it('keeps preface/foreword/introduction', () => {
    const b = book([
      ['preface.xhtml', '<html><body><h1>Preface</h1><p>Why.</p></body></html>'],
      ['ch1.xhtml', '<html><body><h1>Chapter 1</h1><p>One.</p></body></html>'],
    ]);
    b.nav = [
      { label: 'Preface', href: 'preface.xhtml', depth: 1 },
      { label: 'Chapter 1', href: 'ch1.xhtml', depth: 1 },
    ];
    const chapters = planChapters(b, clean);
    expect(chapters.map((c) => c.title)).toEqual(['Preface', 'Chapter 1']);
  });

  it('merges untitled spine files into the previous chapter', () => {
    const b = book([
      ['ch1.xhtml', '<html><body><h1>Chapter 1</h1><p>One.</p></body></html>'],
      ['continuation.xhtml', '<html><body><p>Continues here.</p></body></html>'],
    ]);
    b.nav = [{ label: 'Chapter 1', href: 'ch1.xhtml', depth: 1 }];
    const chapters = planChapters(b, clean);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.html).toContain('Continues here.');
    const ordinals = [...chapters[0]!.html.matchAll(/data-p="(\d+)"/g)].map((m) => m[1]);
    expect(ordinals).toEqual(['0', '1', '2']);
  });

  it('merges bare chapter-number stubs with the following body', () => {
    const b = book([
      ['stub.xhtml', '<html><body><h1>10</h1></body></html>'],
      ['ch10.xhtml', '<html><body><h1>Chapter 10</h1><p>The body.</p></body></html>'],
    ]);
    b.nav = [
      { label: 'Chapter 10', href: 'stub.xhtml', depth: 1 },
      { label: 'Chapter 10', href: 'ch10.xhtml', depth: 1 },
    ];
    const chapters = planChapters(b, clean);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.html).toContain('The body.');
  });

  it('falls back to visible heading when nav is missing', () => {
    const b = book([['ch1.xhtml', '<html><body><h2>Chapter One</h2><p>Text.</p></body></html>']]);
    const chapters = planChapters(b, clean);
    expect(chapters.map((c) => c.title)).toEqual(['Chapter One']);
  });

  it('falls back to Section N when nothing is detectable', () => {
    const b = book([['x.xhtml', '<html><body><p>Just text.</p></body></html>']]);
    const chapters = planChapters(b, clean);
    expect(chapters.map((c) => c.title)).toEqual(['Section 1']);
  });
});

describe('splitSingleFileByHeadings', () => {
  it('splits one HTML file on h2 headings with Part prefixes', () => {
    const sections = splitSingleFileByHeadings(
      `<html><body>
        <h2>Chapter 1</h2><p>One.</p>
        <h2>Chapter 2</h2><p>Two.</p>
        <h2>Chapter 3</h2><p>Three.</p>
      </body></html>`,
    );
    expect(sections.map((s) => s.title)).toEqual(['Part Chapter 1', 'Part Chapter 2', 'Part Chapter 3']);
    expect(sections[0]!.html).toContain('One.');
    expect(sections[1]!.html).toContain('Two.');
    expect(sections[2]!.html).toContain('Three.');
  });

  it('returns empty when fewer than two usable headings', () => {
    const sections = splitSingleFileByHeadings(`<html><body><h2>Chapter 1</h2><p>A.</p></body></html>`);
    expect(sections).toEqual([]);
  });

  it('skips pattern headings and drops leading front-matter headings', () => {
    const sections = splitSingleFileByHeadings(
      `<html><body>
        <h2>Table of Contents</h2><p>list</p>
        <h2>Novel by Someone</h2><p>x</p>
        <h2>Chapter 1</h2><p>A.</p><h2>Chapter 2</h2><p>B.</p>
      </body></html>`,
    );
    expect(sections.map((s) => s.title)).toEqual(['Part Chapter 1', 'Part Chapter 2']);
  });

  it('handles roman numeral and numeric headings', () => {
    const sections = splitSingleFileByHeadings(
      `<html><body><h2>I</h2><p>A.</p><h2>II</h2><p>B.</p><h2>12</h2><p>C.</p></body></html>`,
    );
    expect(sections.map((s) => s.title)).toEqual(['Part I', 'Part II', 'Part 12']);
  });
});
