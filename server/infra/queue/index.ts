import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import type { PingJobData } from '@/jobs/ping';
import { JOB_PING } from '@/jobs/ping';
import type { WorkCoverRefreshJobData } from '@/jobs/work-cover-refresh';
import { JOB_WORK_COVER_REFRESH } from '@/jobs/work-cover-refresh';
import { commonEnv } from '@/server/infra/config/env-common';
import { queueLogger } from '@/server/infra/logging/logger';

export const QUEUE_NAME = 'gloaming';
export const CLEANUP_QUEUE_NAME = 'gloaming-asset-cleanup';

const jobCleanup = { removeOnComplete: 100, removeOnFail: 100 } as const;

let connection: Redis | null = null;
let queue: Queue | null = null;
let cleanupQueue: Queue | null = null;

/** Dedicated BullMQ Redis client. Do not reuse `getRedis()`. */
export function getQueueConnection(): Redis {
  if (connection) {
    return connection;
  }

  connection = new Redis(commonEnv.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on('error', (err) => {
    queueLogger.error({ err }, 'Queue Redis connection error');
  });
  return connection;
}

function createNamedQueue(name: string): Queue {
  return new Queue(name, {
    connection: getQueueConnection(),
    defaultJobOptions: jobCleanup,
  });
}

export function getQueue(): Queue {
  if (queue) {
    return queue;
  }

  queue = createNamedQueue(QUEUE_NAME);
  return queue;
}

export function getCleanupQueue(): Queue {
  if (cleanupQueue) {
    return cleanupQueue;
  }

  cleanupQueue = createNamedQueue(CLEANUP_QUEUE_NAME);
  return cleanupQueue;
}

export type EnqueueJobOptions = {
  attempts?: number;
  backoff?: { type: 'exponential'; delay: number };
  jobId?: string;
  /** BullMQ: 1 is highest; larger values run later (background / warm paths). */
  priority?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
};

async function addJob(target: Queue, name: string, data: unknown, jobOptions?: EnqueueJobOptions): Promise<string> {
  const job = await target.add(name, data, {
    attempts: jobOptions?.attempts,
    backoff: jobOptions?.backoff,
    jobId: jobOptions?.jobId,
    priority: jobOptions?.priority,
    removeOnComplete: jobOptions?.removeOnComplete,
    removeOnFail: jobOptions?.removeOnFail,
  });
  if (!job.id) {
    throw new Error(`Job ${name} was added without an id`);
  }
  return job.id;
}

export async function enqueue(name: string, data: unknown, jobOptions?: EnqueueJobOptions): Promise<string> {
  return addJob(getQueue(), name, data, jobOptions);
}

export async function enqueueCleanup(name: string, data: unknown, jobOptions?: EnqueueJobOptions): Promise<string> {
  return addJob(getCleanupQueue(), name, data, jobOptions);
}

/**
 * Source-cover write-back onto an already-materialized Work. Runs on the main
 * `gloaming` queue so the full worker applies it.
 */
export async function enqueueWorkCoverRefresh(
  data: WorkCoverRefreshJobData,
  jobOptions?: EnqueueJobOptions,
): Promise<string> {
  return addJob(getQueue(), JOB_WORK_COVER_REFRESH, data, jobOptions);
}

export async function enqueuePing(data?: PingJobData): Promise<string> {
  const payload: PingJobData = data ?? { requestedAt: new Date().toISOString() };
  return enqueue(JOB_PING, payload);
}

/**
 * True while a job with this id is still waiting, delayed or running. Recovery
 * paths use it to tell "queued but backed up" from "finished and never re-driven".
 */
export async function hasLiveJob(jobId: string): Promise<boolean> {
  const job = await getQueue().getJob(jobId);
  if (!job) {
    return false;
  }
  const state = await job.getState();
  return state !== 'completed' && state !== 'failed';
}

export async function closeQueue(): Promise<void> {
  if (cleanupQueue) {
    await cleanupQueue.close();
    cleanupQueue = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
