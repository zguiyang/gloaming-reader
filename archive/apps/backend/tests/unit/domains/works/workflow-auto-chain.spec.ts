import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EpubResourceLimitError } from '@/domains/ingest/epub';
import { WORKFLOW_AUTO_CHAIN } from '@/domains/works/lifecycle';

const runContentParseWorkflow = vi.fn();
const enqueue = vi.fn();

vi.mock('@/application/commands/run-content-parse-workflow', () => ({
  runContentParseWorkflow: (...args: unknown[]) => runContentParseWorkflow(...args),
}));

vi.mock('@/infra/queue', () => ({
  enqueue: (...args: unknown[]) => enqueue(...args),
}));

describe('WORKFLOW_AUTO_CHAIN gates', () => {
  beforeEach(() => {
    runContentParseWorkflow.mockReset();
    enqueue.mockReset();
    runContentParseWorkflow.mockResolvedValue(true);
    enqueue.mockResolvedValue(undefined);
  });

  it('is off by default so parse does not auto-enqueue metadata-fill', async () => {
    expect(WORKFLOW_AUTO_CHAIN).toBe(false);
    const { processContentParse } = await import('@/application/jobs/content-parse');
    await processContentParse({ workId: 'work-1', retryJobToken: 'retry-a' }, 'parse-attempt-a');
    expect(runContentParseWorkflow).toHaveBeenCalledWith('work-1', 'retry-a', 'parse-attempt-a');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('marks permanent EPUB validation failures as unrecoverable', async () => {
    runContentParseWorkflow.mockRejectedValueOnce(new EpubResourceLimitError('test limit'));
    const { processContentParse } = await import('@/application/jobs/content-parse');

    await expect(
      processContentParse({ workId: 'work-1', retryJobToken: 'retry-a' }, 'parse-attempt-a'),
    ).rejects.toMatchObject({ name: 'UnrecoverableError', message: expect.stringContaining('test limit') });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
