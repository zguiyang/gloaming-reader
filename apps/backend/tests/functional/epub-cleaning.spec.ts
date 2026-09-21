import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { planChapters } from '@/modules/epub-ingest/chapters';
import { cleanXhtml } from '@/modules/epub-ingest/normalization/normalize-xhtml';
import {
  applyTextPipeline,
  fixDoubleEncodedEntities,
  normalizeWhitespace,
  removeEmptyTags,
} from '@/modules/epub-ingest/text-pipeline';
import type { EpubBook } from '@/modules/epub-ingest/types';

function clean(html: string): { html: string; images: unknown[] } {
  return cleanXhtml(html, (src) => src);
}

/** Fake book with a single spine file — exercises the main chapter loop. */
function bookWithOneFile(rawHtml: string): EpubBook {
  return {
    entries: new Map([['OEBPS/ch.xhtml', Buffer.from(rawHtml)]]),
    opfPath: 'OEBPS/content.opf',
    title: 'T',
    authors: [],
    description: '',
    language: 'en',
    spine: [{ href: 'OEBPS/ch.xhtml', idref: 'x' }],
    nav: [],
    coverHref: null,
    coverMime: null,
  };
}

function plan(book: EpubBook) {
  return planChapters(book, (href, rawHtml) => {
    const cleaned = cleanXhtml(rawHtml, (src) => src);
    return { title: '', html: cleaned.html, images: cleaned.images };
  });
}

describe('cleanXhtml safety rules', () => {
  it('does not let a self-closing <title/> swallow the body (parse5 trap)', () => {
    const result = clean('<html><head><title/></head><body><p>Real content after title.</p></body></html>');
    expect(result.html).toContain('Real content after title.');
  });

  it('repairs self-closing non-void tags like <div/>', () => {
    const result = clean('<html><body><div/><p>kept</p></body></html>');
    expect(result.html).toContain('kept');
    expect(result.html).not.toContain('<div/>');
  });

  it('drops dangerous tags entirely (blacklist) and preserves structure tags', () => {
    const result = clean(
      '<html><body><div><span>prose</span></div><table><tr><td>cell</td></tr></table>' +
        '<iframe src="x"></iframe><script>alert(1)</script><form><input/></form><style>a{}</style>' +
        '<link rel="stylesheet" href="x.css"/></body></html>',
    );
    expect(result.html).toContain('<span>prose</span>');
    expect(result.html).toContain('<table');
    expect(result.html).toContain('<td>cell</td>');
    expect(result.html).not.toContain('iframe');
    expect(result.html).not.toContain('script');
    expect(result.html).not.toContain('<form');
    expect(result.html).not.toContain('<style');
    expect(result.html).not.toContain('<link');
  });

  it('strips on* handlers and downgrades dangerous hrefs to #', () => {
    const result = clean(
      '<html><body><p onclick="alert(1)" onmouseover="x">safe</p>' +
        '<a href="javascript:alert(1)">js</a><a href="https://example.com">ok</a>' +
        '<a href="data:text/html;base64,abc">data</a></body></html>',
    );
    expect(result.html).not.toContain('onclick');
    expect(result.html).not.toContain('onmouseover');
    expect(result.html).toContain('<a href="#">js</a>');
    expect(result.html).toContain('href="https://example.com"');
    expect(result.html).not.toContain('data:text/html');
  });

  it('keeps data:image srcs and drops non-image data srcs', () => {
    const result = clean(
      '<html><body><img src="data:image/png;base64,AAAA"/><img src="data:text/plain;base64,BBBB"/></body></html>',
    );
    expect(result.html).toContain('data:image/png');
    expect(result.html).not.toContain('data:text/plain');
  });

  it('normalizes NFC composed characters', () => {
    const result = clean('<html><body><p>e\u0301 vs \u00e9</p></body></html>');
    expect(result.html).toContain('\u00e9 vs \u00e9');
    expect(result.html).not.toContain('e\u0301');
  });
});

describe('CONTENTS page removal', () => {
  it('drops an in-chapter contents heading and its toc link list', () => {
    const result = clean(
      '<html><body><h2>INTRODUCTION</h2><p>Intro text.</p><h2>CONTENTS</h2>' +
        '<p class="toc"><a class="pginternal" href="#a">THE FOX</a></p>' +
        '<p class="toc"><a class="pginternal" href="#b">THE CROW</a></p>' +
        '<h2>CHAPTER 1</h2><p>Story.</p></body></html>',
    );
    expect(result.html).toContain('Intro text.');
    expect(result.html).not.toContain('CONTENTS');
    expect(result.html).not.toContain('pginternal');
    expect(result.html).toContain('CHAPTER 1');
  });

  it('keeps an h2 that merely mentions contents in prose', () => {
    const result = clean('<html><body><h2>ABOUT THE CONTENTS OF THIS BOOK</h2><p>Body.</p></body></html>');
    expect(result.html).toContain('ABOUT THE CONTENTS OF THIS BOOK');
  });
});

describe('text pipeline', () => {
  it('normalizes whitespace around tags and punctuation', () => {
    const out = normalizeWhitespace('<p>Hello   world .</p>\n\n\n<p>Text </p>');
    expect(out).toBe('<p>Hello world.</p>\n\n<p>Text</p>');
  });

  it('fixes double-encoded entities', () => {
    expect(fixDoubleEncodedEntities('<p>&amp;amp; &amp;lt;</p>')).toBe('<p>&amp; &lt;</p>');
  });

  it('removes empty removable tags and keeps media/void tags', () => {
    const out = removeEmptyTags('<p></p><div> </div><span><em></em></span><br><img src="x"><td></td>');
    expect(out).toBe('<br><img src="x"><td></td>');
  });

  it('runs the full pipeline in order', () => {
    const out = applyTextPipeline('<p>Hello   world .</p>\n\n\n<p></p>');
    expect(out.trim()).toBe('<p>Hello world.</p>');
  });
});

describe('chaptering rules (textstack alignment)', () => {
  it('titles a short copyright page "Copyright" instead of dropping it', () => {
    const book = bookWithOneFile(
      '<html><body><div><p>Copyright © 1912 by Someone. All rights reserved.</p></div></body></html>',
    );
    const chapters = plan(book);
    expect(chapters.map((c) => c.title)).toEqual(['Copyright']);
  });

  it('skips piracy-watermark chapters', () => {
    const book = bookWithOneFile(
      '<html><body><p>Downloaded from a free ebook library. Support the author by purchasing.</p></body></html>',
    );
    expect(plan(book)).toHaveLength(0);
  });

  it('merges an untitled continuation file into the previous chapter', () => {
    const book: EpubBook = {
      entries: new Map([
        ['OEBPS/a.xhtml', Buffer.from('<html><body><h1>Chapter 1</h1><p>One.</p></body></html>')],
        ['OEBPS/b.xhtml', Buffer.from('<html><body><p>Continued prose.</p></body></html>')],
      ]),
      opfPath: 'OEBPS/content.opf',
      title: 'T',
      authors: [],
      description: '',
      language: 'en',
      spine: [
        { href: 'OEBPS/a.xhtml', idref: 'a' },
        { href: 'OEBPS/b.xhtml', idref: 'b' },
      ],
      nav: [],
      coverHref: null,
      coverMime: null,
    };
    const chapters = plan(book);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe('Chapter 1');
    expect(chapters[0]!.html).toContain('Continued prose.');
  });

  it('merges a bare chapter-number stub with its body, keeping the stub title', () => {
    const book: EpubBook = {
      entries: new Map([
        ['OEBPS/a.xhtml', Buffer.from('<html><body><h1>10</h1></body></html>')],
        ['OEBPS/b.xhtml', Buffer.from('<html><body><p>The body of chapter ten.</p></body></html>')],
      ]),
      opfPath: 'OEBPS/content.opf',
      title: 'T',
      authors: [],
      description: '',
      language: 'en',
      spine: [
        { href: 'OEBPS/a.xhtml', idref: 'a' },
        { href: 'OEBPS/b.xhtml', idref: 'b' },
      ],
      nav: [{ label: 'Chapter 10', href: 'OEBPS/a.xhtml', depth: 1 }],
      coverHref: null,
      coverMime: null,
    };
    const chapters = plan(book);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe('Chapter 10');
    expect(chapters[0]!.html).toContain('The body of chapter ten.');
  });

  it('rejects Unknown/Untitled heading titles', () => {
    const book = bookWithOneFile('<html><body><h1>Untitled</h1><p>Body.</p></body></html>');
    expect(plan(book)[0]!.title).toBe('Section 1');
  });
});

describe('cheerio fragment compatibility', () => {
  it('document-mode parsing still handles heading fragments from splits', () => {
    const $ = cheerio.load('<h2>Chapter 1</h2><p>First.</p>');
    expect($('body').html()).toContain('<h2>Chapter 1</h2>');
  });
});
