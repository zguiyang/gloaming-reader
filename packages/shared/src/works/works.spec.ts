import { describe, expect, it } from 'vitest';

import {
  getPublishAudioIssues,
  getPublishPartAudioIssues,
  mergePublishWorkIssues,
  PUBLISH_DEFAULT_AUDIO_ROLE,
} from './works.ts';

describe('publish default audio gate', () => {
  const metadataOk = {
    title: 'Title',
    sources: ['demo'],
    tags: ['story'],
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
        message: '章节「Chapter 1」缺少默认美音（Reader 默认口音，英音可选）',
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
