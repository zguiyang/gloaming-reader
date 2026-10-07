import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { GUTENBERG_TAR_MEMBER_MAX_BYTES } from '@/domains/discovery/gutenberg/constants';
import { GutenbergSnapshotError } from '@/domains/discovery/gutenberg/errors';
import { parseGutenbergRdf } from '@/domains/discovery/gutenberg/rdf-parser';
import { parseGutenbergSnapshotCompressedStream } from '@/domains/discovery/gutenberg/snapshot-stream';
import { iterateTarMembers } from '@/domains/discovery/gutenberg/tar-reader';

const TAR_BLOCK_SIZE = 512;

function writeAscii(buffer: Buffer, offset: number, value: string, length: number): void {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8');
}

/** Minimal ustar header with the fields the reader actually consumes. */
function tarHeader(input: { name: string; size: number; typeFlag?: string; prefix?: string }): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_SIZE);
  writeAscii(header, 0, input.name, 100);
  writeAscii(header, 100, '0000644\0', 8);
  writeAscii(header, 108, '0000000\0', 8);
  writeAscii(header, 116, '0000000\0', 8);
  writeAscii(header, 124, `${input.size.toString(8).padStart(11, '0')}\0`, 12);
  writeAscii(header, 136, '00000000000\0', 12);
  writeAscii(header, 148, '        ', 8);
  header[156] = (input.typeFlag ?? '0').charCodeAt(0);
  writeAscii(header, 257, 'ustar\0', 6);
  writeAscii(header, 263, '00', 2);
  writeAscii(header, 345, input.prefix ?? '', 155);
  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  writeAscii(header, 148, `${checksum.toString(8).padStart(6, '0')}\0 `, 8);
  return header;
}

function tarEntry(input: { name: string; content: Buffer; typeFlag?: string; prefix?: string }): Buffer {
  const padding = (TAR_BLOCK_SIZE - (input.content.length % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
  return Buffer.concat([
    tarHeader({ name: input.name, size: input.content.length, typeFlag: input.typeFlag, prefix: input.prefix }),
    input.content,
    Buffer.alloc(padding),
  ]);
}

function buildTar(entries: Array<{ name: string; content: Buffer; typeFlag?: string; prefix?: string }>): Buffer {
  return Buffer.concat([...entries.map(tarEntry), Buffer.alloc(TAR_BLOCK_SIZE * 2)]);
}

function buildEbookRdf(input: { externalId: string; title: string; agentName: string }): Buffer {
  const { externalId, title, agentName } = input;
  return Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:pgterms="http://www.gutenberg.org/2009/pgterms/">
  <pgterms:ebook rdf:about="ebooks/${externalId}">
    <dcterms:title>${title}</dcterms:title>
    <dcterms:creator>
      <pgterms:agent>
        <pgterms:name>${agentName}, Test</pgterms:name>
        <pgterms:alias>${agentName}</pgterms:alias>
      </pgterms:agent>
    </dcterms:creator>
    <dcterms:language><rdf:Description><rdf:value>en</rdf:value></rdf:Description></dcterms:language>
    <dcterms:language><rdf:Description><rdf:value>fr</rdf:value></rdf:Description></dcterms:language>
    <dcterms:subject><rdf:Description><rdf:value>Fiction</rdf:value></rdf:Description></dcterms:subject>
    <pgterms:bookshelf><rdf:Description><rdf:value>Best Books Ever</rdf:value></rdf:Description></pgterms:bookshelf>
    <dcterms:description>A local synthetic fixture description.</dcterms:description>
    <dcterms:rights>Public domain in the USA.</dcterms:rights>
    <dcterms:issued>1998-06-01</dcterms:issued>
    <dcterms:publisher>Project Gutenberg</dcterms:publisher>
    <dcterms:modified>2021-05-20T10:00:00</dcterms:modified>
    <pgterms:file rdf:about="https://www.gutenberg.org/ebooks/${externalId}.epub3.images">
      <dcterms:format><rdf:Description><rdf:value rdf:resource="http://purl.org/dc/terms/epub"/></rdf:Description></dcterms:format>
      <dcterms:extent>1234</dcterms:extent>
      <dcterms:modified>2021-05-19</dcterms:modified>
    </pgterms:file>
    <pgterms:file rdf:about="https://www.gutenberg.org/cache/epub/${externalId}/pg${externalId}.cover.medium.jpg">
      <dcterms:format><rdf:Description><rdf:value rdf:resource="http://purl.org/dc/terms/IMT/image/jpeg"/></rdf:Description></dcterms:format>
    </pgterms:file>
  </pgterms:ebook>
</rdf:RDF>`,
    'utf8',
  );
}

function bzip2Compress(input: Buffer): Buffer {
  const result = spawnSync('bzip2', ['-zc'], { input, maxBuffer: 64 * 1024 * 1024 });
  expect(result.status).toBe(0);
  expect(result.error).toBeUndefined();
  return result.stdout;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const item of iterable) {
    output.push(item);
  }
  return output;
}

describe('Gutenberg tar reader', () => {
  it('yields members one at a time and stops at the archive terminator', async () => {
    const tar = buildTar([
      { name: 'first.txt', content: Buffer.from('hello') },
      { name: 'nested/second.rdf', content: Buffer.from('<rdf:RDF/>') },
    ]);

    const members = await collect(iterateTarMembers(Readable.from(tar)));
    expect(members.map((member) => member.name)).toEqual(['first.txt', 'nested/second.rdf']);
    expect(members[1]!.content.toString('utf8')).toBe('<rdf:RDF/>');
  });

  it('resolves GNU long names and PAX paths for the following member', async () => {
    const longName = `cache/epub/${'9'.repeat(120)}/pg999999.rdf`;
    const paxPath = 'cache/epub/7777/pg7777.rdf';
    const paxRecord = Buffer.from(`30 path=${paxPath}\n`);
    const tar = Buffer.concat([
      tarEntry({ name: '././@LongLink', content: Buffer.from(`${longName}\0`), typeFlag: 'L' }),
      tarEntry({ name: 'placeholder.rdf', content: Buffer.from('<rdf:RDF/>') }),
      tarEntry({ name: 'pax-header', content: paxRecord, typeFlag: 'x' }),
      tarEntry({ name: 'placeholder2.rdf', content: Buffer.from('<rdf:RDF/>') }),
      Buffer.alloc(TAR_BLOCK_SIZE * 2),
    ]);

    const members = await collect(iterateTarMembers(Readable.from(tar)));
    expect(members.map((member) => member.name)).toEqual([longName, paxPath]);
  });

  it('skips non-file members such as directories', async () => {
    const tar = buildTar([
      { name: 'cache/', content: Buffer.alloc(0), typeFlag: '5' },
      { name: 'cache/pg1.rdf', content: Buffer.from('<rdf:RDF/>') },
    ]);

    const members = await collect(iterateTarMembers(Readable.from(tar)));
    expect(members.map((member) => member.name)).toEqual(['cache/pg1.rdf']);
  });

  it('rejects a member above the bounded decompression limit', async () => {
    const oversized = Buffer.concat([
      tarHeader({ name: 'huge.rdf', size: GUTENBERG_TAR_MEMBER_MAX_BYTES + 1 }),
      Buffer.alloc(TAR_BLOCK_SIZE * 2),
    ]);

    await expect(collect(iterateTarMembers(Readable.from(oversized)))).rejects.toThrow(GutenbergSnapshotError);
  });
});

describe('Gutenberg RDF parsing', () => {
  it('maps a single ebook member onto the SourceRecord shape', () => {
    const record = parseGutenbergRdf(
      buildEbookRdf({ externalId: '1342', title: 'Pride', agentName: 'Austen' }),
      'pg1342.rdf',
    );

    expect(record).not.toBeNull();
    expect(record).toMatchObject({
      externalId: '1342',
      title: 'Pride',
      languages: ['en', 'fr'],
      description: 'A local synthetic fixture description.',
      rightsStatement: 'Public domain in the USA.',
      coverUrl: 'https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg',
    });
    expect(record!.authors).toEqual([{ name: 'Austen', role: 'author', sortName: 'Austen, Test' }]);
    expect(record!.contentCandidates).toEqual([
      {
        format: 'epub',
        url: 'https://www.gutenberg.org/ebooks/1342.epub3.images',
        mimeType: 'epub',
        sizeBytes: 1234,
        updatedAt: '2021-05-19',
      },
    ]);
    expect(record!.sourceMeta).toMatchObject({
      subjects: ['Fiction'],
      bookshelves: ['Best Books Ever'],
      extra: { issued: '1998-06-01', publisher: 'Project Gutenberg' },
    });
    expect(record!.sourceUpdatedAt).toBeInstanceOf(Date);
  });

  it('returns null for a non-ebook RDF document', () => {
    const nonEbook = Buffer.from(
      '<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="x"/></rdf:RDF>',
      'utf8',
    );
    expect(parseGutenbergRdf(nonEbook, 'unrelated.rdf')).toBeNull();
  });
});

describe('Gutenberg compressed snapshot pipeline', () => {
  it('streams local bzip2 + tar + RDF fixtures without network access', async () => {
    const tar = buildTar([
      {
        name: 'cache/epub/11/pg11.rdf',
        content: buildEbookRdf({ externalId: '11', title: 'Alice', agentName: 'Carroll' }),
      },
      { name: 'cache/epub/22/readme.txt', content: Buffer.from('not rdf') },
      {
        name: 'cache/epub/22/pg22.rdf',
        content: buildEbookRdf({ externalId: '22', title: 'Beowulf', agentName: 'Anonymous' }),
      },
      {
        name: 'cache/epub/33/pg33.rdf',
        content: buildEbookRdf({ externalId: '33', title: 'Carmen', agentName: 'Merimee' }),
      },
    ]);

    const records = await collect(parseGutenbergSnapshotCompressedStream(Readable.from(bzip2Compress(tar))));

    expect(records.map((record) => record.externalId)).toEqual(['11', '22', '33']);
    expect(records.map((record) => record.title)).toEqual(['Alice', 'Beowulf', 'Carmen']);
  });

  it('fails when the archive contains no RDF records', async () => {
    const tar = buildTar([{ name: 'cache/epub/1/readme.txt', content: Buffer.from('no records here') }]);

    await expect(collect(parseGutenbergSnapshotCompressedStream(Readable.from(bzip2Compress(tar))))).rejects.toThrow(
      /contained no RDF records/,
    );
  });

  it('reports a sanitized error when bzip2 cannot decompress the stream', async () => {
    await expect(
      collect(parseGutenbergSnapshotCompressedStream(Readable.from(Buffer.from('this is not bzip2 data')))),
    ).rejects.toThrow(GutenbergSnapshotError);
  });
});
