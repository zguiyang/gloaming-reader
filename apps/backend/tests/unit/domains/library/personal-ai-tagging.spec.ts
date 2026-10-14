import { describe, expect, it } from 'vitest';

import {
  JOB_PERSONAL_TAGGING,
  type PersonalTagCandidate,
  type PersonalTagDecision,
  personalTagDecisionSchema,
  personalTaggingJobId,
  validatePersonalTagDecision,
} from '@/domains/library/tags/personal-ai-tagging';

const existing: PersonalTagCandidate[] = [
  {
    id: 'tag-scifi',
    name: '科幻',
    localizedNames: { 'en-US': 'Science Fiction' },
    sourceLocale: 'zh-CN',
  },
  {
    id: 'tag-history',
    name: '历史',
    localizedNames: {},
    sourceLocale: 'zh-CN',
  },
];

function decision(overrides: Partial<PersonalTagDecision> = {}): PersonalTagDecision {
  return { existingTagIds: [], newTags: [], ...overrides };
}

function newTag(name: string, sourceLocale: 'en-US' | 'zh-CN' = 'en-US') {
  return {
    name,
    sourceLocale,
    reusable: true as const,
    distinctFromExisting: true as const,
    rationale: 'A durable, distinct reading topic',
  };
}

describe('Personal AI tag decision validation', () => {
  it('allows a zero-tag result without inventing a label', () => {
    expect(validatePersonalTagDecision(decision(), existing, 'en-US')).toEqual({ existingTagIds: [], newTags: [] });
  });

  it('reuses the stable ID returned for a cross-language existing concept', () => {
    expect(validatePersonalTagDecision(decision({ existingTagIds: ['tag-scifi'] }), existing, 'en-US')).toEqual({
      existingTagIds: ['tag-scifi'],
      newTags: [],
    });
  });

  it('drops foreign, duplicate, and excessive association IDs', () => {
    expect(
      validatePersonalTagDecision(
        decision({ existingTagIds: ['tag-scifi', 'foreign', 'tag-scifi', 'tag-history'] }),
        existing,
        'en-US',
      ).existingTagIds,
    ).toEqual(['tag-scifi', 'tag-history']);
  });

  it('caps automatic association output at three and accepts multiple independently qualified concepts', () => {
    const result = validatePersonalTagDecision(
      decision({ newTags: [newTag('Climate Fiction'), newTag('Space Opera'), newTag('Robotics')] }),
      [],
      'en-US',
    );
    expect(result.newTags).toHaveLength(3);
  });

  it('keeps existing selections first and clips new selections to the remaining association capacity', () => {
    const result = validatePersonalTagDecision(
      decision({
        existingTagIds: ['tag-scifi', 'tag-history'],
        newTags: [newTag('Space Opera'), newTag('Climate Fiction')],
      }),
      existing,
      'en-US',
    );
    expect(result.existingTagIds).toEqual(['tag-scifi', 'tag-history']);
    expect(result.newTags.map((tag) => tag.name)).toEqual(['Space Opera']);
    expect(result.existingTagIds.length + result.newTags.length).toBeLessThanOrEqual(3);
  });

  it('rejects structured output that exceeds three selections across both groups', () => {
    const result = personalTagDecisionSchema.safeParse({
      existingTagIds: ['tag-scifi', 'tag-history'],
      newTags: [newTag('Space Opera'), newTag('Climate Fiction')],
    });
    expect(result.success).toBe(false);
  });

  it('does not create an exact localized-name duplicate or a name in the wrong source language', () => {
    const result = validatePersonalTagDecision(
      decision({ newTags: [newTag('Science Fiction'), newTag('科幻'), newTag('English label', 'zh-CN')] }),
      existing,
      'en-US',
    );
    expect(result.newTags).toEqual([]);
  });
});

describe('Personal AI tag enqueue identity', () => {
  const runId = 'run-1';
  const firstQueuedAt = new Date('2026-01-01T00:00:00.000Z');
  const requeuedAt = new Date('2026-01-02T00:00:00.000Z');

  it('keeps a stable job id for repeated dispatch of one queued run', () => {
    expect(personalTaggingJobId({ id: runId, updatedAt: firstQueuedAt })).toBe(
      personalTaggingJobId({ id: runId, updatedAt: firstQueuedAt }),
    );
  });

  it('changes the job id after a DB requeue so a retained legacy completed job cannot dedupe it', () => {
    const legacyRetainedJobId = `${JOB_PERSONAL_TAGGING}:${runId}`;
    expect(personalTaggingJobId({ id: runId, updatedAt: requeuedAt })).not.toBe(legacyRetainedJobId);
    expect(personalTaggingJobId({ id: runId, updatedAt: requeuedAt })).not.toBe(
      personalTaggingJobId({ id: runId, updatedAt: firstQueuedAt }),
    );
  });
});
