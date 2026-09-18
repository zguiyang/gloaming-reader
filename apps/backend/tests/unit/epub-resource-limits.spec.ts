import { describe, expect, it } from 'vitest';

import { EPUB_ERROR_CODES, EPUB_RESOURCE_LIMITS } from '@/modules/epub-ingest/archive/limits';
import { parseEpub } from '@/modules/epub-ingest/opf/parse';

import { buildEpubBytes } from '../helpers/epub-builder';

describe('EPUB resource limits', () => {
  it('accepts a small normal EPUB', async () => {
    const bytes = await buildEpubBytes({ chapters: [{ href: 'chapter.xhtml', content: '<p>hello</p>' }] });

    await expect(parseEpub(bytes)).resolves.toMatchObject({ title: 'Test Book' });
  });

  it('rejects too many entries before reading their payloads', async () => {
    const bytes = await buildEpubBytes({
      chapters: [{ href: 'chapter.xhtml', content: '<p>hello</p>' }],
      extraEntries: { 'extra.bin': Buffer.from('x') },
    });

    await expect(parseEpub(bytes, { ...EPUB_RESOURCE_LIMITS, maxEntries: 4 })).rejects.toMatchObject({
      code: EPUB_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED,
    });
  });

  it('rejects an entry over the single-entry budget', async () => {
    const bytes = await buildEpubBytes({
      chapters: [{ href: 'chapter.xhtml', content: '<p>hello</p>' }],
      extraEntries: { 'large.bin': Buffer.alloc(5_000, 7) },
    });

    await expect(
      parseEpub(bytes, { ...EPUB_RESOURCE_LIMITS, maxSingleUncompressedBytes: 4_096 }),
    ).rejects.toMatchObject({
      code: EPUB_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED,
    });
  });

  it('rejects the aggregate uncompressed budget', async () => {
    const bytes = await buildEpubBytes({
      chapters: [{ href: 'chapter.xhtml', content: '<p>hello</p>' }],
      extraEntries: {
        'large-a.bin': Buffer.alloc(2_500, 7),
        'large-b.bin': Buffer.alloc(2_500, 8),
      },
    });

    await expect(parseEpub(bytes, { ...EPUB_RESOURCE_LIMITS, maxTotalUncompressedBytes: 4_096 })).rejects.toMatchObject(
      {
        code: EPUB_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED,
      },
    );
  });

  it('uses a stable archive error for malformed input and compressed-size overflow', async () => {
    await expect(parseEpub(Buffer.from('not a zip'))).rejects.toMatchObject({
      code: EPUB_ERROR_CODES.INVALID_ARCHIVE,
    });

    const bytes = await buildEpubBytes({ chapters: [{ href: 'chapter.xhtml', content: '<p>hello</p>' }] });
    await expect(parseEpub(bytes, { ...EPUB_RESOURCE_LIMITS, maxCompressedBytes: 10 })).rejects.toMatchObject({
      code: EPUB_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED,
    });
  });
});
