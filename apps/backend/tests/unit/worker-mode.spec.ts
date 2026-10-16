import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => ({ instances: [] as Array<{ queueName: string }> }));

vi.mock('ioredis', () => ({
  Redis: class {
    on() {
      return this;
    }
    async quit() {
      return 'OK';
    }
  },
}));

vi.mock('bullmq', () => ({
  Queue: class {
    async close() {}
  },
  Worker: class {
    constructor(readonly queueName: string) {
      workerMocks.instances.push({ queueName });
    }
    on() {
      return this;
    }
    async close() {}
  },
}));

const { DISCOVERY_SYNC_ONLY_FLAG, PUBLIC_CLASSIFICATION_ONLY_FLAG, createWorkers, resolveWorkerMode } =
  await import('@/worker');

describe('resolveWorkerMode', () => {
  it('selects public-classification-only only when the CLI flag is present', () => {
    expect(resolveWorkerMode(['node', 'worker.ts', '--public-classification-only'])).toBe('public-classification-only');
    expect(PUBLIC_CLASSIFICATION_ONLY_FLAG).toBe('--public-classification-only');
    expect(resolveWorkerMode(['node', 'worker.ts'])).toBe('full');
    expect(resolveWorkerMode([])).toBe('full');
    expect(resolveWorkerMode(['node', 'worker.ts', DISCOVERY_SYNC_ONLY_FLAG])).toBe('discovery-sync-only');
    expect(resolveWorkerMode(['node', 'worker.ts', '--discovery-import-only'])).toBe('discovery-import-only');
  });

  it('creates exactly one consumer for the discovery-only mode', () => {
    workerMocks.instances.length = 0;
    const queueName = `gloaming-discovery-sync-test-${randomUUID()}`;

    const workers = createWorkers('discovery-sync-only', { discoverySyncQueueName: queueName });

    expect(workerMocks.instances).toEqual([{ queueName }]);
    expect(workers.discoverySyncWorker).toBeDefined();
    expect(workers.worker).toBeUndefined();
    expect(workers.cleanupWorker).toBeUndefined();
    expect(workers.personalTagWorker).toBeUndefined();
    expect(workers.publicClassificationWorker).toBeUndefined();
  });

  it('keeps the import consumer active in full mode while retaining the shared worker', () => {
    workerMocks.instances.length = 0;

    const workers = createWorkers('full');

    expect(workerMocks.instances.map(({ queueName }) => queueName)).toContain('gloaming-discovery-import');
    expect(workers.worker).toBeDefined();
  });

  it('creates only the import consumer in discovery-import-only mode', () => {
    workerMocks.instances.length = 0;
    const mode = resolveWorkerMode(['node', 'worker.ts', '--discovery-import-only']);

    const workers = createWorkers(mode);

    expect(workerMocks.instances).toEqual([{ queueName: 'gloaming-discovery-import' }]);
    expect(workers.worker).toBeUndefined();
    expect(workers.cleanupWorker).toBeUndefined();
    expect(workers.personalTagWorker).toBeUndefined();
    expect(workers.publicClassificationWorker).toBeUndefined();
  });
});
