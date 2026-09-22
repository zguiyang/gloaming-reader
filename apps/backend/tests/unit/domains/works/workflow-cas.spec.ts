import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
}));

vi.mock('@/infra/db', () => ({
  db: {
    update: mocks.update,
  },
}));

import {
  claimWorkflowStep,
  completeWorkflowStep,
  failWorkflowEnqueue,
  failWorkflowStep,
  renewWorkflowClaim,
} from '@/domains/works/lifecycle';

describe('workflow CAS helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ returning: mocks.returning });
  });

  it('reports claim ownership from the conditional update result', async () => {
    mocks.returning.mockResolvedValueOnce([{ id: 'work-1' }]).mockResolvedValueOnce([]);

    await expect(claimWorkflowStep('work-1', 'metadata', 'retry-a', 'attempt-a')).resolves.toBe(true);
    await expect(claimWorkflowStep('work-1', 'metadata', 'retry-a', 'attempt-b')).resolves.toBe(false);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.returning).toHaveBeenCalledTimes(2);
  });

  it('uses the queued identity to reject a different duplicate execution', async () => {
    mocks.returning.mockResolvedValueOnce([{ id: 'work-1' }]).mockResolvedValueOnce([]);

    await expect(claimWorkflowStep('work-1', 'metadata', 'retry-a', 'attempt-a')).resolves.toBe(true);
    await expect(claimWorkflowStep('work-1', 'metadata', 'retry-b', 'attempt-b')).resolves.toBe(false);
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it('rejects a job without an execution identity before touching the database', async () => {
    await expect(claimWorkflowStep('work-1', 'metadata', '', 'attempt-a')).resolves.toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('renews only the currently fenced attempt', async () => {
    mocks.returning.mockResolvedValueOnce([{ id: 'work-1' }]).mockResolvedValueOnce([]);

    await expect(renewWorkflowClaim('work-1', 'parse', 'retry-a', 'attempt-a')).resolves.toBe(true);
    await expect(renewWorkflowClaim('work-1', 'parse', 'retry-a', 'attempt-a')).resolves.toBe(false);
    expect(mocks.returning).toHaveBeenCalledTimes(2);
  });

  it('rejects stale completion and failure updates when no row is affected', async () => {
    mocks.returning.mockResolvedValue([]);

    await expect(completeWorkflowStep('work-1', 'ready', undefined, 'tts')).resolves.toBe(false);
    await expect(failWorkflowStep('work-1', 'tts', 'retry-a', 'attempt-a', new Error('stale'))).resolves.toBe(false);
    expect(mocks.where).toHaveBeenCalledTimes(2);
    expect(mocks.returning).toHaveBeenCalledTimes(2);
  });

  it('marks a claimed step failed when enqueue compensation is needed', async () => {
    mocks.returning.mockResolvedValueOnce([{ id: 'work-1' }]);

    await expect(
      failWorkflowEnqueue('work-1', 'metadata', 'retry-a', 'metadata', 'attempt-a', new Error('queue down')),
    ).resolves.toBe(true);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.where).toHaveBeenCalledTimes(1);
    expect(mocks.returning).toHaveBeenCalledTimes(1);
  });
});
