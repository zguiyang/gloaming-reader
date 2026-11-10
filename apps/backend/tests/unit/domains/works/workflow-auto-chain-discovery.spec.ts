import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runContentParseWorkflow: vi.fn(),
  enqueue: vi.fn(),
  dbSelect: vi.fn(),
  rotateWorkflowJobToken: vi.fn(),
  failWorkflowEnqueue: vi.fn(),
  reviveFailedSaveIntentsForWorkParseRetry: vi.fn(),
  failSaveIntentsForWorkParseFailure: vi.fn(),
  fanOutReadySaveIntentsForWork: vi.fn(),
  enqueuePersonalTagRunForReadyWork: vi.fn(),
}));

vi.mock('@/application/commands/run-content-parse-workflow', () => ({
  runContentParseWorkflow: mocks.runContentParseWorkflow,
}));

vi.mock('@/infra/queue', () => ({ enqueue: mocks.enqueue }));
vi.mock('@/infra/db', () => ({ db: { select: mocks.dbSelect } }));
vi.mock('@/infra/logging/logger', () => ({ rootLogger: { child: () => ({ warn: vi.fn() }) } }));
vi.mock('@/domains/works/lifecycle', () => ({
  WORKFLOW_AUTO_CHAIN: true,
  failWorkflowEnqueue: mocks.failWorkflowEnqueue,
  rotateWorkflowJobToken: mocks.rotateWorkflowJobToken,
}));
vi.mock('@/domains/library/save-intent', () => ({
  cleanSaveIntentFailureReason: (reason: string) => reason,
  failSaveIntentsForWorkParseFailure: mocks.failSaveIntentsForWorkParseFailure,
  fanOutReadySaveIntentsForWork: mocks.fanOutReadySaveIntentsForWork,
  reviveFailedSaveIntentsForWorkParseRetry: mocks.reviveFailedSaveIntentsForWorkParseRetry,
}));
vi.mock('@/domains/library/tags/personal-ai-tagging', () => ({
  enqueuePersonalTagRunForReadyWork: mocks.enqueuePersonalTagRunForReadyWork,
}));
vi.mock('@/domains/ingest/epub', () => ({ isEpubValidationError: () => false }));
vi.mock('@gloaming/db', () => ({ readingWork: { originKind: 'originKind' } }));
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal()),
  eq: vi.fn(),
}));

const { processContentParse } = await import('@/application/jobs/content-parse');

describe('Discovery content parse auto-chain boundary', () => {
  beforeEach(() => {
    mocks.runContentParseWorkflow.mockReset().mockResolvedValue(true);
    mocks.enqueue.mockReset().mockResolvedValue('metadata-job');
    mocks.rotateWorkflowJobToken.mockReset().mockResolvedValue(true);
    mocks.failWorkflowEnqueue.mockReset().mockResolvedValue(undefined);
    mocks.reviveFailedSaveIntentsForWorkParseRetry.mockReset().mockResolvedValue(undefined);
    mocks.failSaveIntentsForWorkParseFailure.mockReset().mockResolvedValue(undefined);
    mocks.fanOutReadySaveIntentsForWork.mockReset().mockResolvedValue(undefined);
    mocks.enqueuePersonalTagRunForReadyWork.mockReset().mockResolvedValue(undefined);
    mocks.dbSelect.mockReset().mockImplementation(() => {
      const query = {
        from: () => query,
        where: () => query,
        limit: async () => [{ originKind: null }],
      };
      return query;
    });
  });

  it('keeps legacy/default parse auto-chain behavior when the workflow switch is enabled', async () => {
    await processContentParse({ workId: 'work-legacy', retryJobToken: 'retry-a' }, 'attempt-a');

    expect(mocks.enqueue).toHaveBeenCalledWith(
      'metadata-fill',
      expect.objectContaining({ workId: 'work-legacy' }),
      expect.objectContaining({ attempts: 2 }),
    );
  });

  it('does not enqueue metadata AI work for the discovery lane when auto-chain is enabled', async () => {
    await processContentParse(
      {
        workId: 'work-source',
        retryJobToken: 'retry-b',
        processingLane: 'discovery',
      } as Parameters<typeof processContentParse>[0],
      'attempt-b',
    );

    expect(mocks.runContentParseWorkflow).toHaveBeenCalledWith('work-source', 'retry-b', 'attempt-b');
    expect(mocks.enqueuePersonalTagRunForReadyWork).toHaveBeenCalledWith('work-source');
    expect(mocks.dbSelect).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
