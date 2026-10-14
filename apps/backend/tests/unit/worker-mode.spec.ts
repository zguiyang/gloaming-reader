import { describe, expect, it, vi } from 'vitest';

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
    on() {
      return this;
    }
    async close() {}
  },
}));

const { PUBLIC_CLASSIFICATION_ONLY_FLAG, resolveWorkerMode } = await import('@/worker');

describe('resolveWorkerMode', () => {
  it('selects public-classification-only only when the CLI flag is present', () => {
    expect(resolveWorkerMode(['node', 'worker.ts', '--public-classification-only'])).toBe('public-classification-only');
    expect(PUBLIC_CLASSIFICATION_ONLY_FLAG).toBe('--public-classification-only');
    expect(resolveWorkerMode(['node', 'worker.ts'])).toBe('full');
    expect(resolveWorkerMode([])).toBe('full');
  });
});
