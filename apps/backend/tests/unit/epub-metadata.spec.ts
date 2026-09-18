import { describe, expect, it } from 'vitest';

import { cleanDescription } from '@/modules/epub-ingest/metadata';
import { parseEpub } from '@/modules/epub-ingest/opf/parse';
import { metadataByLocalName, textOfDeep } from '@/modules/epub-ingest/opf/xml';

import { buildEpubBytes } from '../helpers/epub-builder';

describe('textOfDeep', () => {
  it('returns plain strings unchanged', () => {
    expect(textOfDeep('plain text')).toBe('plain text');
  });

  it('reads #text nodes', () => {
    expect(textOfDeep({ '#text': 'hello' })).toBe('hello');
  });

  it('concatenates nested element children (VersOne.Epub XElement.Value semantics)', () => {
    expect(textOfDeep({ p: 'First paragraph' })).toBe('First paragraph');
    expect(textOfDeep({ div: { span: 'Nested' }, p: 'Sibling' })).toBe('NestedSibling');
  });

  it('flattens arrays in document order', () => {
    expect(textOfDeep([{ '#text': 'a' }, 'b', { p: 'c' }])).toBe('abc');
  });

  it('skips attribute keys', () => {
    expect(textOfDeep({ '#text': 'value', '@_xml:lang': 'en' })).toBe('value');
  });
});

describe('metadataByLocalName', () => {
  const metadata = {
    'dc:description': 'dc value',
    'dcterms:description': 'dcterms value',
    description: 'bare value',
    'DC:Description': 'upper value',
  };

  it('matches the dc: prefixed key first (object order)', () => {
    expect(metadataByLocalName(metadata, 'description')).toBe('dc value');
  });

  it('matches prefix-less keys when no prefixed one exists', () => {
    expect(metadataByLocalName({ description: 'bare' }, 'description')).toBe('bare');
  });

  it('is case-insensitive on the local name', () => {
    expect(metadataByLocalName({ 'DCTERMS:Description': 'x' }, 'description')).toBe('x');
  });

  it('takes the first element when the value is an array', () => {
    expect(metadataByLocalName({ 'dc:description': ['first', 'second'] }, 'description')).toBe('first');
  });

  it('returns undefined when nothing matches', () => {
    expect(metadataByLocalName({ 'dc:creator': 'a' }, 'description')).toBeUndefined();
  });

  it('tolerates missing metadata (empty object)', () => {
    expect(metadataByLocalName({}, 'description')).toBeUndefined();
  });
});

describe('cleanDescription', () => {
  it('strips HTML tags', () => {
    expect(cleanDescription('<p>Some <b>story</b> about it.</p>')).toBe('Some story about it.');
  });

  it('decodes HTML entities', () => {
    expect(cleanDescription('Tom &amp; Jerry &nbsp; &#39;quoted&#39;')).toBe("Tom & Jerry 'quoted'");
  });

  it('collapses whitespace and trims', () => {
    expect(cleanDescription('  line one\n   line two \t ')).toBe('line one line two');
  });

  it('returns empty string for empty input', () => {
    expect(cleanDescription('')).toBe('');
    expect(cleanDescription('   ')).toBe('');
  });
});

describe('parseEpub metadata extraction (builder variants)', () => {
  const chapters = [
    { href: 'chapter-1.xhtml', tocLabel: 'Chapter 1', content: '<html><body><p>Body.</p></body></html>' },
  ];

  it('joins child elements of a <p>-wrapped description', async () => {
    const bytes = await buildEpubBytes({
      descriptionHtml: '<p>First sentence.</p><p>Second sentence.</p>',
      chapters,
    });
    const book = await parseEpub(bytes);
    expect(book.description).toBe('First sentence.Second sentence.');
  });

  it('takes the first of multiple dc:description entries', async () => {
    const bytes = await buildEpubBytes({
      descriptions: ['First description', 'Second description'],
      chapters,
    });
    const book = await parseEpub(bytes);
    expect(book.description).toBe('First description');
  });

  it('matches the dcterms: prefix', async () => {
    const bytes = await buildEpubBytes({
      description: 'Dcterms description',
      useDctermsPrefix: true,
      chapters,
    });
    const book = await parseEpub(bytes);
    expect(book.title).toBe('Test Book');
    expect(book.description).toBe('Dcterms description');
  });

  it('extracts subjects and source', async () => {
    const bytes = await buildEpubBytes({
      subjects: ['Science Fiction', 'Adventure'],
      sourceRaw: 'https://example.com/books/source',
      chapters,
    });
    const book = await parseEpub(bytes);
    expect(book.subjects).toEqual(['Science Fiction', 'Adventure']);
    expect(book.sourceRaw).toBe('https://example.com/books/source');
  });
});
