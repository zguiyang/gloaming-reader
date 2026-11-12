import { describe, expect, it } from 'vitest';

import {
  continueReadingItemSchema,
  isUserTagTranslationMissing,
  LIBRARY_ITEMS_LIMIT,
  libraryDataSchema,
  resolveUserTagName,
  sourceRecordSaveResultSchema,
  userTagSchema,
  userTagWriteSchema,
} from './library.ts';

const work = {
  id: 'w1',
  title: 'Ocean Quiet',
  description: '',
  coverAssetId: null,
  publishedAt: null,
};

const state = {
  status: 'in_progress' as const,
  currentPartId: 'p1',
  progressRatio: 40,
  completedThroughSortOrder: 0,
  totalPartCount: 3,
  lastReadAt: '2026-08-21T00:00:00.000Z',
  completedAt: null,
};

describe('Library contracts', () => {
  it('keeps localized labels on one stable tag and falls back without claiming a translation', () => {
    const tag = userTagSchema.parse({
      id: 'tag-1',
      name: 'Children’s Literature',
      sourceLocale: 'en-US',
      localizedNames: { 'en-US': 'Children’s Literature' },
      userEditedLocales: ['en-US'],
    });
    expect(resolveUserTagName(tag, 'zh-CN')).toBe('Children’s Literature');
    expect(isUserTagTranslationMissing(tag, 'zh-CN')).toBe(true);
    expect(isUserTagTranslationMissing(tag, 'en-US')).toBe(false);
    expect(userTagSchema.parse({ id: 'old-tag', name: 'Old name' })).toMatchObject({
      localizedNames: {},
      sourceLocale: null,
      userEditedLocales: [],
    });
  });

  it('defaults tag provenance to manual and keeps an explicit AI origin', () => {
    expect(userTagSchema.parse({ id: 'old-tag', name: 'Legacy payload' }).createdBy).toBe('manual');
    expect(userTagSchema.parse({ id: 'ai-tag', name: 'AI label', createdBy: 'ai' }).createdBy).toBe('ai');
    expect(userTagSchema.safeParse({ id: 'x', name: 'x', createdBy: 'robot' }).success).toBe(false);
  });

  it('keeps SourceRecord Save Intent results pending or ready with an explicit work id', () => {
    expect(sourceRecordSaveResultSchema.parse({ status: 'pending', workId: null })).toEqual({
      status: 'pending',
      workId: null,
    });
    expect(sourceRecordSaveResultSchema.parse({ status: 'ready', workId: 'work-1' })).toEqual({
      status: 'ready',
      workId: 'work-1',
    });
    expect(sourceRecordSaveResultSchema.safeParse({ status: 'completed', workId: 'work-1' }).success).toBe(false);
  });

  it('rejects control and bidirectional override characters in manual names', () => {
    expect(() => userTagWriteSchema.parse({ name: 'two\nlines' })).toThrow();
    expect(() => userTagWriteSchema.parse({ name: 'hidden\u202eorder' })).toThrow();
    expect(userTagWriteSchema.parse({ name: 'C++' })).toMatchObject({ name: 'C++' });
  });

  it('accepts owned or saved works with and without reading progress', () => {
    const parsed = libraryDataSchema.parse({
      current: { work, state },
      items: [
        {
          work,
          state: null,
          availability: 'ready',
          libraryItemKind: 'personal',
          personalMetadata: { author: 'A' },
          canRemoveFromLibrary: false,
          userTags: [],
        },
        {
          work,
          state,
          availability: 'ready',
          libraryItemKind: 'saved_catalog',
          personalMetadata: null,
          canRemoveFromLibrary: true,
          userTags: [{ id: 'tag-1', name: 'Favorite' }],
        },
      ],
    });

    expect(parsed.items[0]?.state).toBeNull();
    expect(parsed.items[1]?.state?.progressRatio).toBe(40);
    expect(parsed.items[0]?.canRemoveFromLibrary).toBe(false);
    expect(parsed.items[1]?.canRemoveFromLibrary).toBe(true);
    expect(parsed.items[1]?.userTags).toEqual([
      {
        id: 'tag-1',
        name: 'Favorite',
        localizedNames: {},
        sourceLocale: null,
        userEditedLocales: [],
        createdBy: 'manual',
      },
    ]);
    expect(parsed.current?.state).toEqual(state);
    expect(LIBRARY_ITEMS_LIMIT).toBe(48);
  });

  it('defaults the truncation marker to false and keeps an explicit true', () => {
    const legacyPayload = { current: null, items: [] };
    expect(libraryDataSchema.parse(legacyPayload)).toEqual({ current: null, items: [], isTruncated: false });
    expect(libraryDataSchema.parse({ ...legacyPayload, isTruncated: true }).isTruncated).toBe(true);
    expect(libraryDataSchema.parse({ ...legacyPayload, isTruncated: false }).isTruncated).toBe(false);
    expect(() => libraryDataSchema.parse({ ...legacyPayload, isTruncated: 'yes' })).toThrow();
  });

  it('limits item readiness to processing, readable, or failed', () => {
    const base = {
      work,
      state: null,
      canRemoveFromLibrary: false,
      libraryItemKind: 'personal' as const,
      personalMetadata: { author: '' },
      userTags: [],
    };
    expect(() => libraryDataSchema.parse({ current: null, items: [{ ...base, availability: 'metadata' }] })).toThrow();
    expect(
      libraryDataSchema.parse({ current: null, items: [{ ...base, availability: 'processing' }] }).items[0]
        ?.availability,
    ).toBe('processing');
    expect(
      libraryDataSchema.parse({ current: null, items: [{ ...base, availability: 'failed' }] }).items[0]?.availability,
    ).toBe('failed');
  });

  it('keeps Continue Reading as an independent progress projection', () => {
    expect(continueReadingItemSchema.parse({ work, state })).toEqual({ work, state });
    expect(() => continueReadingItemSchema.parse({ work, state: null })).toThrow();
  });
});
