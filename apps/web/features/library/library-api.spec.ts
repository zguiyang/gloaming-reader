import { afterEach, describe, expect, it, vi } from 'vitest';

import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import {
  assignUserTag,
  createUserTag,
  deleteUserTag,
  libraryRefetchInterval,
  personalEpubValidationError,
  renameUserTag,
  unassignUserTag,
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
            libraryItemKind: 'personal',
            personalMetadata: { author: '' },
            canRemoveFromLibrary: false,
            userTags: [],
          },
        ],
      } as never),
    ).toBe(2000);
  });
});

describe('User Tag API', () => {
  it('uses the private Library tag contract for CRUD and associations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'tag-1', name: 'Favorite' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'tag-1', name: 'Reading' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createUserTag('Favorite')).resolves.toEqual({ id: 'tag-1', name: 'Favorite' });
    await expect(renameUserTag('tag-1', 'Reading')).resolves.toEqual({ id: 'tag-1', name: 'Reading' });
    await assignUserTag('work-1', 'tag-1');
    await unassignUserTag('work-1', 'tag-1');
    await deleteUserTag('tag-1');

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/library/tags', 'POST'],
      ['/api/library/tags/tag-1', 'PATCH'],
      ['/api/library/work-1/tags/tag-1', 'PUT'],
      ['/api/library/work-1/tags/tag-1', 'DELETE'],
      ['/api/library/tags/tag-1', 'DELETE'],
    ]);
    expect(calls[0]?.[1].body).toBe(JSON.stringify({ name: 'Favorite' }));
    expect(calls[1]?.[1].body).toBe(JSON.stringify({ name: 'Reading' }));
  });
});
