import type { Job, Worker } from 'bullmq';
import { Worker as BullWorker } from 'bullmq';

import { JOB_ASSET_CLEANUP, processAssetCleanup } from '@/jobs/asset-cleanup';
import { type ContentParseJobData, JOB_CONTENT_PARSE, processContentParse } from '@/jobs/content-parse';
import type { PingJobData } from '@/jobs/ping';
import { JOB_PING, processPing } from '@/jobs/ping';
import {
  JOB_WORK_COVER_REFRESH,
  processWorkCoverRefresh,
  type WorkCoverRefreshJobData,
} from '@/jobs/work-cover-refresh';
import { recoverStalledContentParses } from '@/server/application/commands/recover-stalled-content-parses';
import { commonEnv } from '@/server/infra/config/env-common';
import { workerLogger } from '@/server/infra/logging/logger';
import { reportRuntimeBoot } from '@/server/infra/logging/runtime-boot';
import { CLEANUP_QUEUE_NAME, closeQueue, getQueueConnection, QUEUE_NAME } from '@/server/infra/queue';

export const CLEANUP_WORKER_CONCURRENCY = 1;

export async function processJob(job: Pick<Job, 'name' | 'data'>): Promise<unknown> {
  switch (job.name) {
    case JOB_PING:
      return processPing(job.data as PingJobData);
    case JOB_CONTENT_PARSE:
      return processContentParse(job.data as ContentParseJobData);
    case JOB_WORK_COVER_REFRESH:
      return processWorkCoverRefresh(job.data as WorkCoverRefreshJobData);
    default:
      throw new Error(`Unknown job name: ${job.name}`);
  }
}

export async function processCleanupJob(job: Pick<Job, 'name' | 'data'>): Promise<unknown> {
  if (job.name !== JOB_ASSET_CLEANUP) {
    throw new Error(`Unknown cleanup job name: ${job.name}`);
  }
  return processAssetCleanup(job.data as { jobId: string; scanId: string });
}

function attachWorkerEvents(worker: Worker, queue: string): void {
  worker.on('active', (job) => {
    workerLogger.info({ jobId: job.id, name: job.name, queue, data: job.data }, 'Job active');
  });
  worker.on('completed', (job) => {
    workerLogger.info({ jobId: job.id, name: job.name, queue }, 'Job completed');
  });
  worker.on('failed', (job, err) => {
    workerLogger.error({ err, jobId: job?.id, name: job?.name, queue }, 'Job failed');
  });
  worker.on('error', (err) => {
    workerLogger.error({ err, queue }, 'Worker error');
  });
}

export function createWorkers(): { worker: Worker; cleanupWorker: Worker } {
  const connection = getQueueConnection();

  const worker = new BullWorker(QUEUE_NAME, async (job) => processJob(job), {
    connection,
  });
  const cleanupWorker = new BullWorker(CLEANUP_QUEUE_NAME, async (job) => processCleanupJob(job), {
    connection,
    concurrency: CLEANUP_WORKER_CONCURRENCY,
  });

  attachWorkerEvents(worker, QUEUE_NAME);
  attachWorkerEvents(cleanupWorker, CLEANUP_QUEUE_NAME);

  return { worker, cleanupWorker };
}

async function main(): Promise<void> {
  await reportRuntimeBoot('jobs');
  const { worker, cleanupWorker } = createWorkers();

  let dispatcherRunning = false;
  const dispatch = async () => {
    if (dispatcherRunning) return;
    dispatcherRunning = true;
    try {
      await recoverStalledContentParses();
    } catch (error) {
      workerLogger.warn({ err: error }, 'Stalled workflow recovery pass failed');
    } finally {
      dispatcherRunning = false;
    }
  };
  void dispatch();
  const dispatchTimer = setInterval(() => void dispatch(), 60_000);
  dispatchTimer.unref?.();

  workerLogger.info(
    {
      queue: QUEUE_NAME,
      cleanupQueue: CLEANUP_QUEUE_NAME,
      nodeEnv: commonEnv.NODE_ENV,
    },
    'Worker listening',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(dispatchTimer);
    workerLogger.info({ signal }, 'Worker shutting down');
    await Promise.all([worker.close(), cleanupWorker.close()]);
    await closeQueue();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

if (!process.env.VITEST) {
  main().catch((err: unknown) => {
    workerLogger.error({ err }, 'Worker failed to start');
    process.exit(1);
  });
}
