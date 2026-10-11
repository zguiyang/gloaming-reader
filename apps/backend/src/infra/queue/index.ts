import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import type { PingJobData } from '@/application/jobs/ping';
import { JOB_PING } from '@/application/jobs/ping';
import { commonEnv } from '@/infra/config/env-common';
import { queueLogger } from '@/infra/logging/logger';

export const QUEUE_NAME = 'gloaming';
export const CLEANUP_QUEUE_NAME = 'gloaming-asset-cleanup';
export const PERSONAL_TAG_QUEUE_NAME = 'gloaming-personal-tags';

const jobCleanup = { removeOnComplete: 100, removeOnFail: 100 } as const;

let connection: Redis | null = null;
let queue: Queue | null = null;
let cleanupQueue: Queue | null = null;
let personalTagQueue: Queue | null = null;

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

export function getPersonalTagQueue(): Queue {
  if (personalTagQueue) return personalTagQueue;
  personalTagQueue = createNamedQueue(PERSONAL_TAG_QUEUE_NAME);
  return personalTagQueue;
}

export type EnqueueJobOptions = {
  attempts?: number;
  backoff?: { type: 'exponential'; delay: number };
  jobId?: string;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
};

async function addJob(target: Queue, name: string, data: unknown, jobOptions?: EnqueueJobOptions): Promise<string> {
  const job = await target.add(name, data, {
    attempts: jobOptions?.attempts,
    backoff: jobOptions?.backoff,
    jobId: jobOptions?.jobId,
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

export async function enqueuePersonalTagging(
  name: string,
  data: unknown,
  jobOptions?: EnqueueJobOptions,
): Promise<string> {
  return addJob(getPersonalTagQueue(), name, data, jobOptions);
}

export async function enqueuePing(data?: PingJobData): Promise<string> {
  const payload: PingJobData = data ?? { requestedAt: new Date().toISOString() };
  return enqueue(JOB_PING, payload);
}

export async function closeQueue(): Promise<void> {
  if (personalTagQueue) {
    await personalTagQueue.close();
    personalTagQueue = null;
  }
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
