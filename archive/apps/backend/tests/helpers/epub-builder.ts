import JSZip from 'jszip';

/** Minimal EPUB3 builder for ingest tests. */
export type EpubBuildInput = {
  title?: string;
  authors?: string[];
  description?: string;
  /** Description with child elements (e.g. `<p>…</p>`), inserted verbatim. */
  descriptionHtml?: string;
  /** Multiple `<dc:description>` entries (first one wins on read). */
  descriptions?: string[];
  /** Use the `dcterms:` prefix for Dublin Core metadata instead of `dc:`. */
  useDctermsPrefix?: boolean;
  subjects?: string[];
  sourceRaw?: string;
  language?: string;
  /** spine entries: { href, content (XHTML), tocLabel? } */
  chapters: Array<{ href: string; content: string; tocLabel?: string }>;
  coverHref?: string;
  coverBytes?: Buffer;
  /** Extra zip entries (href → bytes). */
  extraEntries?: Record<string, Buffer | string>;
  /** Use EPUB2 (NCX) instead of EPUB3 nav document. */
  epub2?: boolean;
};

export async function buildEpubBytes(input: EpubBuildInput): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  const navItems = input.chapters
    .filter((c) => c.tocLabel)
    .map((c) => `<li><a href="${c.href}">${c.tocLabel}</a></li>`)
    .join('');

  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    ...input.chapters.map((c, i) => `<item id="ch${i}" href="${c.href}" media-type="application/xhtml+xml"/>`),
    ...(input.coverHref
      ? [`<item id="cover" href="${input.coverHref}" media-type="image/jpeg" properties="cover-image"/>`]
      : []),
  ].join('\n    ');

  const spineRefs = input.chapters.map((_, i) => `<itemref idref="ch${i}"/>`).join('\n    ');

  const prefix = input.useDctermsPrefix ? 'dcterms' : 'dc';

  const descriptionEntries = input.descriptions
    ? input.descriptions.map((d) => `<${prefix}:description>${d}</${prefix}:description>`).join('\n    ')
    : input.descriptionHtml
      ? `<${prefix}:description>${input.descriptionHtml}</${prefix}:description>`
      : input.description
        ? `<${prefix}:description>${input.description}</${prefix}:description>`
        : '';

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
    <dc:identifier id="bookid">urn:uuid:test-${Date.now()}</dc:identifier>
    <${prefix}:title>${input.title ?? 'Test Book'}</${prefix}:title>
    ${(input.authors ?? []).map((a) => `<dc:creator>${a}</dc:creator>`).join('\n    ')}
    ${descriptionEntries}
    <dc:language>${input.language ?? 'en-US'}</dc:language>
    ${(input.subjects ?? []).map((s) => `<dc:subject>${s}</dc:subject>`).join('\n    ')}
    ${input.sourceRaw ? `<dc:source>${input.sourceRaw}</dc:source>` : ''}
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineRefs}
  </spine>
</package>`;

  if (input.epub2) {
    const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    ${input.chapters
      .filter((c) => c.tocLabel)
      .map(
        (c, i) =>
          `<navPoint id="np${i}" playOrder="${i + 1}">
      <navLabel><text>${c.tocLabel}</text></navLabel>
      <content src="${c.href}"/>
    </navPoint>`,
      )
      .join('\n    ')}
  </navMap>
</ncx>`;
    zip.file('OEBPS/toc.ncx', ncx);
  } else {
    zip.file(
      'OEBPS/nav.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc">
      <ol>${navItems}</ol>
    </nav>
  </body>
</html>`,
    );
  }

  zip.file('OEBPS/content.opf', opf);

  for (const chapter of input.chapters) {
    zip.file(`OEBPS/${chapter.href}`, chapter.content);
  }

  if (input.coverHref) {
    zip.file(`OEBPS/${input.coverHref}`, input.coverBytes ?? Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]));
  }

  for (const [href, bytes] of Object.entries(input.extraEntries ?? {})) {
    zip.file(`OEBPS/${href}`, bytes);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

/** A complete small EPUB3: cover, three chapters with TOC labels. */
export async function buildSampleEpubBytes(): Promise<Buffer> {
  return buildEpubBytes({
    title: 'The Great Book (for $author)',
    authors: ['Jane Author'],
    description: 'A sample story.',
    language: 'en-US',
    coverHref: 'cover.jpg',
    coverBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    chapters: [
      {
        href: 'chapter-1.xhtml',
        tocLabel: 'Chapter 1',
        content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head>
<body><h1>Chapter 1</h1><p>Call me Ishmael.</p><p>Some years ago I thought I would sail about a little.</p></body></html>`,
      },
      {
        href: 'chapter-2.xhtml',
        tocLabel: 'Chapter 2',
        content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 2</title></head>
<body><h1>Chapter 2</h1><p>The second chapter begins.</p></body></html>`,
      },
      {
        href: 'chapter-3.xhtml',
        tocLabel: 'Chapter 3',
        content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 3</title></head>
<body><h1>Chapter 3</h1><p>And then it ends.</p></body></html>`,
      },
    ],
  });
}
