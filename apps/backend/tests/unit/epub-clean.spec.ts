import { describe, expect, it } from 'vitest';

import { stripOrphanImagePlaceholders } from '@/modules/epub-ingest/normalization/images';
import { cleanXhtml } from '@/modules/epub-ingest/normalization/normalize-xhtml';
import { reindexLeafParagraphOrdinals } from '@/modules/works/part-content/paragraph-identity';

describe('cleanXhtml', () => {
  it('keeps allowed tags and strips dangerous ones (blacklist)', () => {
    const { html } = cleanXhtml(
      `<html><head><title>T</title></head><body>
        <p>Safe <em>text</em>.</p>
        <script>alert(1)</script>
        <style>p{color:red}</style>
        <iframe src="https://evil.example"></iframe>
        <nav><a href="#">home</a></nav>
      </body></html>`,
      () => '',
    );
    expect(html).toContain('<p');
    expect(html).toContain('<em>text</em>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('style');
    expect(html).not.toContain('iframe');
    // Blacklist approach keeps nav (textstack behavior).
    expect(html).toContain('<nav');
  });

  it('removes on* attributes and dangerous URL schemes', () => {
    const { html } = cleanXhtml(
      `<p onclick="alert(1)" onmouseover="x()">Hi <a href="javascript:alert(1)">bad</a> <a href="/relative">good</a></p>`,
      () => '',
    );
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onmouseover');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="/relative"');
  });

  it('rewrites local image srcs and keeps external/data images', () => {
    const { html, images } = cleanXhtml(
      `<p><img src="images/fig1.png"/><img src="https://cdn.example/x.jpg"/><img src="data:image/png;base64,AAAA"/></p>`,
      (src) => `/img/${src}`,
    );
    expect(html).toContain('src="/img/images/fig1.png"');
    expect(html).toContain('cdn.example');
    expect(html).toContain('data:image');
    expect(images).toEqual([{ href: 'images/fig1.png', mime: 'image/png' }]);
  });

  it('keeps safe data images and removes non-image data URIs across image-only and nested content', () => {
    const image = 'data:image/png;base64,AAAA';
    const unsafeData = 'data:text/html;base64,PHNjcmlwdD4=';
    const { html } = cleanXhtml(
      `<img src="${image}"/><img src="${unsafeData}"/><div><figure><img src="${image}"/></figure></div><div><img src="${image}"/>Caption</div>`,
      () => '',
    );

    expect(html.match(/data:image\/png;base64,AAAA/g)).toHaveLength(3);
    expect(html).not.toContain(unsafeData);
    expect(html).toContain('<figure');
    expect(html).toContain('Caption');
  });

  it('keeps structure tags like span (blacklist)', () => {
    const { html } = cleanXhtml(`<p>Before <span class="x">inner</span> after</p>`, () => '');
    expect(html).toContain('inner');
    expect(html).toContain('<span');
    expect(html).toContain('class="x"');
  });

  it('injects data-p ordinals on leaf block elements only', () => {
    const { html } = cleanXhtml(`<p>One</p><blockquote>Two</blockquote><p>Three</p>`, () => '');
    expect(html).toContain('data-p="0"');
    expect(html).toContain('data-p="1"');
    expect(html).toContain('data-p="2"');
  });

  it('skips wrapper blocks so nested intro keeps a single data-p', () => {
    const { html } = cleanXhtml(
      `<blockquote><div><p><b>On this world ignored man....</b></p></div></blockquote><p>Trudging homeward.</p>`,
      () => '',
    );
    expect(html).toContain('<p data-p="0">');
    expect(html).toContain('<p data-p="1">');
    expect(html).not.toMatch(/<(blockquote|div)[^>]*data-p=/);
  });

  it('reindexLeafParagraphOrdinals removes duplicates after spine-style merge', () => {
    const a = cleanXhtml(`<h1>Title</h1><p>by Author</p>`, () => '').html;
    const b = cleanXhtml(`<p>Trudging homeward.</p><p>He spent the day.</p>`, () => '').html;
    const merged = `${a}\n${b}`;
    expect([...merged.matchAll(/data-p="0"/g)]).toHaveLength(2);

    const fixed = reindexLeafParagraphOrdinals(merged);
    const ordinals = [...fixed.matchAll(/data-p="(\d+)"/g)].map((m) => m[1]);
    expect(ordinals).toEqual(['0', '1', '2', '3']);
    expect(fixed).toContain('Title');
    expect(fixed).toContain('Trudging homeward.');
  });

  it('keeps footnote markers (sup) in HTML but drops empty paragraphs', () => {
    const { html } = cleanXhtml(`<p>Text<sup>1</sup>.</p><p>   </p>`, () => '');
    expect(html).toContain('Text');
    expect(html).toContain('<sup>1</sup>');
  });

  it('preserves ../ in local hrefs passed to rewriteImageSrc', () => {
    const seen: string[] = [];
    cleanXhtml(`<p><img src="../Images/fig.png"/></p>`, (src) => {
      seen.push(src);
      return `/img/${src}`;
    });
    expect(seen).toEqual(['../Images/fig.png']);
  });

  it('removes Gutenberg noimages figcenter stubs', () => {
    const { html } = cleanXhtml(
      `<html><body>
        <div class="figcenter"><a id="id_1"><span id="img_images_052-2.jpg">THE FOX AND THE STORK</span></a></div>
        <h2>THE WOLF</h2>
        <p>A Wolf resolved.</p>
      </body></html>`,
      () => '',
    );
    expect(html).not.toContain('THE FOX AND THE STORK');
    expect(html).not.toContain('img_images_');
    expect(html).not.toContain('figcenter');
    expect(html).toContain('THE WOLF');
    expect(html).toContain('A Wolf resolved.');
  });

  it('strips leading empty wrappers and decorative hr before the chapter title', () => {
    const { html } = cleanXhtml(
      `<html><body>
        <div class="pg_body_wrapper"><br/></div>
        <div class="pg_body_wrapper"><br/></div>
        <hr/>
        <div class="pg_body_wrapper"><br/></div>
        <h2>LIST OF ILLUSTRATIONS</h2>
        <p class="toc"><a href="#x">Item</a></p>
        <hr class="major"/>
        <p>Later section.</p>
      </body></html>`,
      () => '',
    );
    expect(html).toMatch(/^<h2/);
    expect(html).not.toContain('pg_body_wrapper');
    expect(html.indexOf('LIST OF ILLUSTRATIONS')).toBeLessThan(html.indexOf('<hr'));
    expect(html).toContain('Later section.');
  });

  it('keeps real local images while dropping empty-src imgs', () => {
    const { html, images } = cleanXhtml(
      `<p><img src="a.png" alt="ok"/><img src="" alt="gone"/><img alt="also-gone"/></p>`,
      (src) => `/x/${src}`,
    );
    expect(html).toContain('src="/x/a.png"');
    expect(html).not.toContain('gone');
    expect(images).toEqual([{ href: 'a.png', mime: 'image/png' }]);
  });
});

describe('stripOrphanImagePlaceholders', () => {
  it('removes imgs whose placeholder was not resolved', () => {
    const keep = '__GLOAMING_IMG__keep__';
    const drop = '__GLOAMING_IMG__drop__';
    const html = `<p><img src="${keep}"/><img src="${drop}"/></p>`;
    const out = stripOrphanImagePlaceholders(html, new Set([keep]));
    expect(out).toContain(keep);
    expect(out).not.toContain(drop);
  });
});
