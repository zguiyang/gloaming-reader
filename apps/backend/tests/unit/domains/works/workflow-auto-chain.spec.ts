import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EpubResourceLimitError } from '@/domains/ingest';
import { getWorkflowPolicyProjection, WORKFLOW_AUTO_CHAIN } from '@/domains/works';

const processContentWork = vi.fn();
const enqueue = vi.fn();

vi.mock('@/domains/ingest/parser', () => ({
  processContentWork: (...args: unknown[]) => processContentWork(...args),
}));

vi.mock('@/infra/queue', () => ({
  enqueue: (...args: unknown[]) => enqueue(...args),
}));

describe('WORKFLOW_AUTO_CHAIN gates', () => {
  beforeEach(() => {
    processContentWork.mockReset();
    enqueue.mockReset();
    processContentWork.mockResolvedValue(true);
    enqueue.mockResolvedValue(undefined);
  });

  it('is off by default so parse does not auto-enqueue metadata-fill', async () => {
    expect(WORKFLOW_AUTO_CHAIN).toBe(false);
    expect(getWorkflowPolicyProjection()).toEqual({ autoChainEnabled: false, ttsStepEnabled: false });
    const { processContentParse } = await import('@/application/jobs/content-parse');
    await processContentParse({ workId: 'work-1', retryJobToken: 'retry-a' }, 'parse-attempt-a');
    expect(processContentWork).toHaveBeenCalledWith('work-1', 'retry-a', 'parse-attempt-a');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('marks permanent EPUB validation failures as unrecoverable', async () => {
    processContentWork.mockRejectedValueOnce(new EpubResourceLimitError('test limit'));
    const { processContentParse } = await import('@/application/jobs/content-parse');

    await expect(
      processContentParse({ workId: 'work-1', retryJobToken: 'retry-a' }, 'parse-attempt-a'),
    ).rejects.toMatchObject({ name: 'UnrecoverableError', message: expect.stringContaining('test limit') });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
