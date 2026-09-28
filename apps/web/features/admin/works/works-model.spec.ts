import { describe, expect, it } from 'vitest';

import {
  adminWorksListQueryForFilter,
  type AdminWorkSummaryView,
  canPreviewWork,
  filterAdminWorksListItems,
  isTtsWorkflowActive,
  isWorkPublished,
} from './works-model';

function summary(overrides: Partial<AdminWorkSummaryView> = {}): AdminWorkSummaryView {
  return {
    id: 'w1',
    title: 'T',
    author: 'A',
    description: '',
    language: 'en',
    processingStatus: 'ready',
    visibility: 'catalog',
    originKind: 'admin_epub',
    tags: [],
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
    workflowPolicy: { autoChainEnabled: false, ttsStepEnabled: false },
    derivedFreshness: { audio: 'missing' },
    originMeta: {},
    originAsset: null,
    partCount: 1,
    category: null,
    failedStep: null,
    metadataProvenance: {},
    ...overrides,
  };
}

describe('canPreviewWork', () => {
  it('allows preview when chapters exist and workflow is not blocking', () => {
    expect(canPreviewWork({ processingStatus: 'parsed', partCount: 3 })).toBe(true);
    expect(canPreviewWork({ processingStatus: 'ready', parts: [{}, {}] })).toBe(true);
    expect(canPreviewWork({ processingStatus: 'ready', partCount: 1 })).toBe(true);
  });

  it('blocks preview without chapters or during blocking workflow states', () => {
    expect(canPreviewWork({ processingStatus: 'parsed', partCount: 0 })).toBe(false);
    expect(canPreviewWork({ processingStatus: 'uploaded', partCount: 2 })).toBe(false);
    expect(canPreviewWork({ processingStatus: 'processing', partCount: 2 })).toBe(false);
    expect(canPreviewWork({ processingStatus: 'metadata', partCount: 2 })).toBe(false);
    expect(canPreviewWork({ processingStatus: 'failed', partCount: 2 })).toBe(false);
  });
});

describe('publication and TTS workflow helpers', () => {
  it('detects publication from publishedAt', () => {
    expect(isWorkPublished({ publishedAt: null })).toBe(false);
    expect(isWorkPublished({ publishedAt: '2026-01-01T00:00:00.000Z' })).toBe(true);
  });

  it('detects active TTS workflow step from originMeta', () => {
    expect(isTtsWorkflowActive({ originMeta: {} })).toBe(false);
    expect(isTtsWorkflowActive({ originMeta: { workflowEnqueueStep: 'tts' } })).toBe(true);
    expect(isTtsWorkflowActive({ originMeta: { workflowClaimStep: 'tts' } })).toBe(true);
  });
});

describe('admin works list filters', () => {
  it('maps tabs to list query params', () => {
    expect(adminWorksListQueryForFilter('all')).toEqual({});
    expect(adminWorksListQueryForFilter('failed')).toEqual({ processingStatus: 'failed' });
    expect(adminWorksListQueryForFilter('published')).toEqual({ publicationStatus: 'published' });
    expect(adminWorksListQueryForFilter('ready')).toEqual({
      processingStatus: 'ready',
      publicationStatus: 'unpublished',
    });
    expect(adminWorksListQueryForFilter('busy').processingStatus).toContain('ready');
  });

  it('refines busy tab client-side for active TTS workflow', () => {
    const items = [
      summary({ id: 'draft', processingStatus: 'ready', publishedAt: null }),
      summary({
        id: 'tts',
        processingStatus: 'ready',
        originMeta: { workflowEnqueueStep: 'tts' },
      }),
    ];
    expect(filterAdminWorksListItems(items, 'published').map((w) => w.id)).toEqual(['draft', 'tts']);
    expect(filterAdminWorksListItems(items, 'ready').map((w) => w.id)).toEqual(['draft', 'tts']);
    expect(filterAdminWorksListItems(items, 'busy').map((w) => w.id)).toEqual(['tts']);
  });
});
