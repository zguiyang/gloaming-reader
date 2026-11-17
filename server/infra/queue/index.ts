import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { type DiscoverySyncJobData, JOB_DISCOVERY_SYNC } from '@/jobs/discovery-sync-contract';
import type { PingJobData } from '@/jobs/ping';
import { JOB_PING } from '@/jobs/ping';
import type { WorkCoverRefreshJobData } from '@/jobs/work-cover-refresh';
import { JOB_WORK_COVER_REFRESH } from '@/jobs/work-cover-refresh';
import {
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SYNC_CRON_PATTERN,
  PROJECT_GUTENBERG_SYNC_SCHEDULER_ID,
} from '@/server/domains/discovery/gutenberg/constants';
import { commonEnv } from '@/server/infra/config/env-common';
import { queueLogger } from '@/server/infra/logging/logger';

export const QUEUE_NAME = 'gloaming';
export const DISCOVERY_IMPORT_QUEUE_NAME = 'gloaming-discovery-import';
export const DISCOVERY_SYNC_QUEUE_NAME = 'gloaming-discovery-sync';
export const CLEANUP_QUEUE_NAME = 'gloaming-asset-cleanup';

const jobCleanup = { removeOnComplete: 100, removeOnFail: 100 } as const;

let connection: Redis | null = null;
let queue: Queue | null = null;
let discoveryImportQueue: Queue | null = null;
let discoverySyncQueue: Queue | null = null;
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

/** Dedicated queue for SourceRecord materialization and EPUB parsing. */
export function getDiscoveryImportQueue(): Queue {
  if (discoveryImportQueue) return discoveryImportQueue;
  discoveryImportQueue = createNamedQueue(DISCOVERY_IMPORT_QUEUE_NAME);
  return discoveryImportQueue;
}

/** Dedicated queue for bounded catalog index sync (metadata only). */
export function getDiscoverySyncQueue(): Queue {
  if (discoverySyncQueue) return discoverySyncQueue;
  discoverySyncQueue = createNamedQueue(DISCOVERY_SYNC_QUEUE_NAME);
  return discoverySyncQueue;
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

export async function enqueueDiscoveryImport(
  name: string,
  data: unknown,
  jobOptions?: EnqueueJobOptions,
): Promise<string> {
  return addJob(getDiscoveryImportQueue(), name, data, jobOptions);
}

export async function enqueueDiscoverySync(
  name: string,
  data: unknown,
  jobOptions?: EnqueueJobOptions,
): Promise<string> {
  return addJob(getDiscoverySyncQueue(), name, data, jobOptions);
}

/**
 * Registers (or updates) the weekly Project Gutenberg catalog sync scheduler.
 * Scheduled jobs carry `trigger: 'schedule'` and claim ownership inside the worker.
 */
export async function upsertProjectGutenbergDiscoverySyncScheduler(): Promise<void> {
  const queue = getDiscoverySyncQueue();
  const payload: DiscoverySyncJobData = {
    sourceKey: PROJECT_GUTENBERG_SOURCE_KEY,
    trigger: 'schedule',
  };
  await queue.upsertJobScheduler(
    PROJECT_GUTENBERG_SYNC_SCHEDULER_ID,
    { pattern: PROJECT_GUTENBERG_SYNC_CRON_PATTERN },
    {
      name: JOB_DISCOVERY_SYNC,
      data: payload,
      opts: { attempts: 1 },
    },
  );
  queueLogger.info(
    { schedulerId: PROJECT_GUTENBERG_SYNC_SCHEDULER_ID, pattern: PROJECT_GUTENBERG_SYNC_CRON_PATTERN },
    'Discovery catalog sync scheduler upserted',
  );
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
export async function hasLiveJob(lane: 'default' | 'discovery', jobId: string): Promise<boolean> {
  const target = lane === 'discovery' ? getDiscoveryImportQueue() : getQueue();
  const job = await target.getJob(jobId);
  if (!job) {
    return false;
  }
  const state = await job.getState();
  return state !== 'completed' && state !== 'failed';
}

export async function closeQueue(): Promise<void> {
  if (discoverySyncQueue) {
    await discoverySyncQueue.close();
    discoverySyncQueue = null;
  }
  if (discoveryImportQueue) {
    await discoveryImportQueue.close();
    discoveryImportQueue = null;
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
