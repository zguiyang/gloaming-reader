import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors/app-error';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/modules/oss';
import {
  fileExtension,
  hashFileContent,
  isValidContentHash,
  isZipFile,
  uploadObjectFile,
  type UploadSpec,
  validateUploadInput,
} from '@/modules/uploads/service';

import { createMemoryObjectStore } from '../helpers/memory-oss';

const EPUB_SPEC: UploadSpec = {
  allowedExtensions: ['epub'],
  allowedMimeTypes: ['application/epub+zip', 'application/zip', 'application/octet-stream'],
  maxBytes: 10 * 1024,
  validateContent: (body) => (isZipFile(body) ? null : 'EPUB 文件内容无效（非 ZIP 格式）'),
  keyBuilder: (contentHash) => `epub/${contentHash}.epub`,
};

const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);

function zipBody(size = 64): Buffer {
  const body = Buffer.alloc(size);
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(body);
  return body;
}

describe('fileExtension', () => {
  it('extracts a lower-case extension', () => {
    expect(fileExtension('My Book.EPUB')).toBe('epub');
    expect(fileExtension('book.epub')).toBe('epub');
    expect(fileExtension('no-extension')).toBe('');
  });
});

describe('isZipFile', () => {
  it('detects zip magic bytes', () => {
    expect(isZipFile(ZIP_BYTES)).toBe(true);
    expect(isZipFile(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(false);
    expect(isZipFile(Buffer.from('plain text'))).toBe(false);
  });
});

describe('hashFileContent', () => {
  it('returns a stable sha256 hex digest', () => {
    expect(hashFileContent(Buffer.from('abc'))).toBe(hashFileContent(Buffer.from('abc')));
    expect(hashFileContent(Buffer.from('abc'))).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('isValidContentHash', () => {
  it('accepts 64-char lowercase hex only', () => {
    const valid = hashFileContent(Buffer.from('abc'));
    expect(isValidContentHash(valid)).toBe(true);
    expect(isValidContentHash(valid.toUpperCase())).toBe(false);
    expect(isValidContentHash(valid.slice(1))).toBe(false);
    expect(isValidContentHash('not-a-hash')).toBe(false);
    expect(isValidContentHash('')).toBe(false);
  });
});

describe('validateUploadInput', () => {
  it('returns the normalized MIME type for valid input', () => {
    expect(
      validateUploadInput({
        fileName: 'b.epub',
        body: zipBody(),
        contentType: 'application/epub+zip',
        spec: EPUB_SPEC,
      }),
    ).toEqual({
      mimeType: 'application/epub+zip',
    });
    expect(validateUploadInput({ fileName: 'b.epub', body: zipBody(), contentType: '', spec: EPUB_SPEC })).toEqual({
      mimeType: 'application/octet-stream',
    });
  });

  it('rejects bad extensions, MIME types, sizes and content without touching storage', () => {
    expect(() =>
      validateUploadInput({ fileName: 'b.pdf', body: zipBody(), contentType: 'application/pdf', spec: EPUB_SPEC }),
    ).toThrow(AppError);
    expect(() =>
      validateUploadInput({ fileName: 'b.epub', body: zipBody(), contentType: 'application/x-flash', spec: EPUB_SPEC }),
    ).toThrow(AppError);
    expect(() =>
      validateUploadInput({
        fileName: 'b.epub',
        body: zipBody(EPUB_SPEC.maxBytes + 1),
        contentType: 'application/epub+zip',
        spec: EPUB_SPEC,
      }),
    ).toThrow(AppError);
    expect(() =>
      validateUploadInput({
        fileName: 'b.epub',
        body: Buffer.from('plain'),
        contentType: 'application/epub+zip',
        spec: EPUB_SPEC,
      }),
    ).toThrow(AppError);
  });
});

describe('uploadObjectFile', () => {
  const memory = createMemoryObjectStore();

  beforeEach(() => {
    memory.store.clear();
    setObjectStoreForTests(memory);
  });

  afterEach(() => {
    resetObjectStoreCache();
  });

  it('stores a valid EPUB and returns its metadata', async () => {
    const body = zipBody();
    const meta = await uploadObjectFile({
      key: 'epub/work-1.epub',
      fileName: 'My Book.epub',
      body,
      contentType: 'application/epub+zip',
      spec: EPUB_SPEC,
    });

    expect(meta).toEqual({
      storageKey: 'epub/work-1.epub',
      mimeType: 'application/epub+zip',
      contentHash: hashFileContent(body),
      size: body.length,
    });
    expect(memory.store.has('epub/work-1.epub')).toBe(true);
  });

  it('rejects non-EPUB extensions (pdf / txt / no extension)', async () => {
    for (const fileName of ['book.pdf', 'book.txt', 'book']) {
      await expect(
        uploadObjectFile({
          key: 'epub/x.epub',
          fileName,
          body: zipBody(),
          contentType: 'application/pdf',
          spec: EPUB_SPEC,
        }),
      ).rejects.toSatisfy((error: unknown) => error instanceof AppError && error.statusCode === 400);
    }
  });

  it('rejects unexpected MIME types', async () => {
    await expect(
      uploadObjectFile({
        key: 'epub/x.epub',
        fileName: 'book.epub',
        body: zipBody(),
        contentType: 'application/x-shockwave-flash',
        spec: EPUB_SPEC,
      }),
    ).rejects.toSatisfy((error: unknown) => error instanceof AppError && error.statusCode === 400);
  });

  it('allows empty MIME type from browsers', async () => {
    await expect(
      uploadObjectFile({
        key: 'epub/x.epub',
        fileName: 'book.epub',
        body: zipBody(),
        contentType: '',
        spec: EPUB_SPEC,
      }),
    ).resolves.toMatchObject({ mimeType: 'application/octet-stream' });
  });

  it('rejects files over the size cap', async () => {
    await expect(
      uploadObjectFile({
        key: 'epub/x.epub',
        fileName: 'book.epub',
        body: zipBody(EPUB_SPEC.maxBytes + 1),
        contentType: 'application/epub+zip',
        spec: EPUB_SPEC,
      }),
    ).rejects.toSatisfy((error: unknown) => error instanceof AppError && error.statusCode === 400);
  });

  it('rejects files that fail the content validator', async () => {
    await expect(
      uploadObjectFile({
        key: 'epub/x.epub',
        fileName: 'book.epub',
        body: Buffer.from('not a zip at all'),
        contentType: 'application/epub+zip',
        spec: EPUB_SPEC,
      }),
    ).rejects.toSatisfy((error: unknown) => error instanceof AppError && error.statusCode === 400);
    expect(memory.store.size).toBe(0);
  });
});
