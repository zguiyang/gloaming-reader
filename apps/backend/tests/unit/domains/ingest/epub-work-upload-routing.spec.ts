import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  enqueueDiscoveryImport: vi.fn(),
  prepareWorkflowEnqueue: vi.fn(),
  failWorkflowEnqueue: vi.fn(),
}));

vi.mock('@/infra/queue', () => ({
  enqueue: mocks.enqueue,
  enqueueDiscoveryImport: mocks.enqueueDiscoveryImport,
}));

vi.mock('@/domains/works/lifecycle/workflow', () => ({
  prepareWorkflowEnqueue: mocks.prepareWorkflowEnqueue,
  failWorkflowEnqueue: mocks.failWorkflowEnqueue,
}));

const { enqueueCoreEpubParse } = await import('@/domains/ingest/epub/work-upload');

describe('enqueueCoreEpubParse queue routing', () => {
  beforeEach(() => {
    mocks.enqueue.mockReset().mockResolvedValue('default-job');
    mocks.enqueueDiscoveryImport.mockReset().mockResolvedValue('discovery-job');
    mocks.prepareWorkflowEnqueue.mockReset().mockResolvedValue(true);
    mocks.failWorkflowEnqueue.mockReset().mockResolvedValue(undefined);
  });

  it('keeps the default lane on the general queue and omits optional context', async () => {
    await enqueueCoreEpubParse({ workId: 'work-personal', retryJobToken: 'retry-a', currentStatus: 'uploaded' });

    expect(mocks.enqueue).toHaveBeenCalledWith(
      'content-parse',
      { workId: 'work-personal', retryJobToken: 'retry-a' },
      expect.objectContaining({ attempts: 2, jobId: 'content-parse-work-personal-retry-a' }),
    );
    expect(mocks.enqueueDiscoveryImport).not.toHaveBeenCalled();
  });

  it('routes an explicit discovery parse lane to the import queue with its retry context', async () => {
    await enqueueCoreEpubParse({
      workId: 'work-source',
      retryJobToken: 'retry-b',
      currentStatus: 'failed',
      processingLane: 'discovery',
    } as Parameters<typeof enqueueCoreEpubParse>[0]);

    expect(mocks.enqueueDiscoveryImport).toHaveBeenCalledWith(
      'content-parse',
      { workId: 'work-source', retryJobToken: 'retry-b', processingLane: 'discovery' },
      expect.objectContaining({ attempts: 2, jobId: 'content-parse-work-source-retry-b' }),
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
