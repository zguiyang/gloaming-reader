import { afterEach, describe, expect, it, vi } from 'vitest';

import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import {
  libraryRefetchInterval,
  personalEpubValidationError,
  uploadPersonalEpub,
} from '@/features/library/library-api';

afterEach(() => vi.unstubAllGlobals());

describe('personal EPUB upload', () => {
  it('accepts EPUB files up to the backend size limit', () => {
    expect(personalEpubValidationError({ name: 'Book.EPUB', size: EPUB_UPLOAD_MAX_BYTES })).toBeNull();
    expect(personalEpubValidationError({ name: 'Book.pdf', size: 12 })).toBe('format');
    expect(personalEpubValidationError({ name: 'Book.epub', size: EPUB_UPLOAD_MAX_BYTES + 1 })).toBe('size');
  });

  it('posts the file to the Personal Works endpoint and parses the safe response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'work-1', title: 'Book', processingStatus: 'uploaded' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadPersonalEpub(new File(['epub'], 'Book.epub', { type: 'application/epub+zip' }));

    expect(result).toMatchObject({ id: 'work-1', processingStatus: 'uploaded' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/works');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toMatchObject({ name: 'Book.epub' });
  });

  it('refreshes while Library contains processing items only', () => {
    expect(libraryRefetchInterval()).toBe(false);
    expect(libraryRefetchInterval({ items: [], current: null })).toBe(false);
    expect(
      libraryRefetchInterval({
        current: null,
        items: [
          {
            work: { id: 'work-1' },
            state: null,
            availability: 'processing',
            canRemoveFromLibrary: false,
          },
        ],
      } as never),
    ).toBe(2000);
  });
});
