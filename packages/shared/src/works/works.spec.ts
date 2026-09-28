import { describe, expect, it } from 'vitest';

import {
  adminWorkListQuerySchema,
  getPublishAudioIssues,
  getPublishPartAudioIssues,
  mergePublishWorkIssues,
  personalWorkUploadResultSchema,
  PUBLISH_DEFAULT_AUDIO_ROLE,
  updateWorkBodySchema,
  WORK_PROCESSING_STATUSES,
  workOriginKindSchema,
  workProcessingStatusSchema,
  workSchema,
} from './works.ts';

function taxonomyRef(id: string, zh: string, en: string) {
  return {
    id,
    names: { 'zh-CN': zh, 'en-US': en },
    origin: 'manual' as const,
  };
}

function sourceRef(id: string, name: string) {
  return { id, name, origin: 'manual' as const };
}

describe('work processing status contracts', () => {
  it('allows only the decided processing values', () => {
    expect(WORK_PROCESSING_STATUSES).toEqual(['uploaded', 'processing', 'parsed', 'metadata', 'ready', 'failed']);
    for (const value of WORK_PROCESSING_STATUSES) {
      expect(workProcessingStatusSchema.parse(value)).toBe(value);
    }
    expect(workProcessingStatusSchema.safeParse('published').success).toBe(false);
    expect(workProcessingStatusSchema.safeParse('tts').success).toBe(false);
  });

  it('uses processingStatus on work DTOs and list filters', () => {
    const work = workSchema.parse({
      id: 'work-1',
      title: 'Title',
      author: 'Author',
      description: '',
      language: 'en',
      processingStatus: 'ready',
      visibility: 'catalog',
      originKind: 'admin_epub',
      tags: [],
      category: null,
      sources: [],
      coverAssetId: null,
      wordCount: null,
      estimatedMinutes: null,
      suggestedVocabSize: null,
      difficultyScore: null,
      statsProvenance: null,
      publishedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(work.processingStatus).toBe('ready');
    const { processingStatus: _processingStatus, ...withoutProcessingStatus } = work;
    expect(workSchema.safeParse({ ...withoutProcessingStatus, status: 'ready' }).success).toBe(false);

    const query = adminWorkListQuerySchema.parse({ processingStatus: 'processing,metadata' });
    expect(query.processingStatus).toBe('processing,metadata');
    expect(adminWorkListQuerySchema.safeParse({ processingStatus: 'published' }).success).toBe(false);
  });

  it('accepts optional publicationStatus on admin list queries', () => {
    expect(adminWorkListQuerySchema.parse({ publicationStatus: 'published' }).publicationStatus).toBe('published');
    expect(adminWorkListQuerySchema.parse({ publicationStatus: 'unpublished' }).publicationStatus).toBe('unpublished');
    expect(
      adminWorkListQuerySchema.parse({
        processingStatus: 'ready',
        publicationStatus: 'unpublished',
      }),
    ).toEqual({
      page: 1,
      pageSize: 10,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      processingStatus: 'ready',
      publicationStatus: 'unpublished',
    });
    expect(adminWorkListQuerySchema.safeParse({ publicationStatus: 'draft' }).success).toBe(false);
    expect(adminWorkListQuerySchema.parse({ status: 'published' }).publicationStatus).toBeUndefined();
  });

  it('supports server-side TTS workflow filtering and safe Personal upload results', () => {
    expect(
      adminWorkListQuerySchema.parse({ processingStatus: 'uploaded,processing,parsed,metadata', workflowStep: 'tts' }),
    ).toMatchObject({ processingStatus: 'uploaded,processing,parsed,metadata', workflowStep: 'tts' });
    expect(adminWorkListQuerySchema.safeParse({ workflowStep: 'unknown' }).success).toBe(false);
    expect(workOriginKindSchema.parse('user_epub')).toBe('user_epub');
    expect(personalWorkUploadResultSchema.parse({ id: 'work-1', title: 'Book', processingStatus: 'uploaded' })).toEqual(
      { id: 'work-1', title: 'Book', processingStatus: 'uploaded' },
    );
    expect(
      personalWorkUploadResultSchema.parse({
        id: 'work-1',
        title: 'Book',
        processingStatus: 'uploaded',
        storageKey: 'epub/private.epub',
      }),
    ).toEqual({ id: 'work-1', title: 'Book', processingStatus: 'uploaded' });
  });
});

describe('update work body contracts', () => {
  it('accepts taxonomy selections with id only', () => {
    const body = updateWorkBodySchema.parse({
      tags: [{ id: 'tag-1' }],
      sources: [{ id: 'source-1' }],
      category: { id: 'category-1' },
    });
    expect(body.tags).toEqual([{ id: 'tag-1' }]);
    expect(body.sources).toEqual([{ id: 'source-1' }]);
    expect(body.category).toEqual({ id: 'category-1' });
  });

  it('accepts null category to clear the selection', () => {
    expect(updateWorkBodySchema.parse({ category: null }).category).toBeNull();
  });

  it('rejects full taxonomy references in update payloads', () => {
    const fullRef = taxonomyRef('tag-1', '科学', 'Science');
    expect(updateWorkBodySchema.safeParse({ tags: [fullRef] }).success).toBe(false);
    expect(updateWorkBodySchema.safeParse({ sources: [fullRef] }).success).toBe(false);
    expect(updateWorkBodySchema.safeParse({ category: fullRef }).success).toBe(false);
  });
});

describe('publish default audio gate', () => {
  const metadataOk = {
    title: 'Title',
    sources: [sourceRef('source-1', 'demo')],
    tags: [taxonomyRef('tag-1', 'story', 'story')],
    parts: [{ body: 'Hello world.' }],
  };

  it('does not require audio when synth text is empty', () => {
    expect(
      getPublishPartAudioIssues({
        partId: 'part-1',
        partTitle: 'Intro',
        bodyPlain: '   ',
        defaultTrackStatus: 'none',
      }),
    ).toEqual([]);
  });

  it('rejects parts with body but missing default audio', () => {
    const issues = getPublishPartAudioIssues({
      partId: 'part-1',
      partTitle: 'Chapter 1',
      bodyPlain: 'Hello world.',
      defaultTrackStatus: 'none',
    });
    expect(issues).toEqual([
      {
        path: `parts.part-1.audio.${PUBLISH_DEFAULT_AUDIO_ROLE}`,
        code: 'api.errors.work.publish.audioMissing',
        params: { partTitle: 'Chapter 1' },
      },
    ]);
  });

  it('passes when default audio is ready with matching content hash', () => {
    expect(
      getPublishPartAudioIssues({
        partId: 'part-1',
        partTitle: 'Chapter 1',
        bodyPlain: 'Hello world.',
        defaultTrackStatus: 'ready',
      }),
    ).toEqual([]);
  });

  it.each(['stale', 'failed', 'generating'] as const)('rejects non-ready track status %s', (status) => {
    const issues = getPublishPartAudioIssues({
      partId: 'part-1',
      partTitle: 'Chapter 1',
      bodyPlain: 'Hello world.',
      defaultTrackStatus: status,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe(`parts.part-1.audio.${PUBLISH_DEFAULT_AUDIO_ROLE}`);
  });

  it('merges metadata and audio issues for publishWork', () => {
    const issues = mergePublishWorkIssues(metadataOk, [
      {
        partId: 'part-1',
        partTitle: 'Chapter 1',
        bodyPlain: 'Hello world.',
        defaultTrackStatus: 'none',
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toContain('.audio.us');
  });

  it('aggregates audio issues across multiple parts', () => {
    const issues = getPublishAudioIssues([
      {
        partId: 'part-1',
        partTitle: 'One',
        bodyPlain: 'Text one.',
        defaultTrackStatus: 'none',
      },
      {
        partId: 'part-2',
        partTitle: 'Two',
        bodyPlain: '',
        defaultTrackStatus: 'none',
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe(`parts.part-1.audio.${PUBLISH_DEFAULT_AUDIO_ROLE}`);
  });
});
