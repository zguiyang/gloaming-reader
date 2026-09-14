import { describe, expect, it } from 'vitest';

import {
  getPublishAudioIssues,
  getPublishPartAudioIssues,
  mergePublishWorkIssues,
  PUBLISH_DEFAULT_AUDIO_ROLE,
  updateWorkBodySchema,
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
