import type { Job, Worker } from 'bullmq';
import { Worker as BullWorker } from 'bullmq';

import {
  JOB_ASSET_CLEANUP,
  JOB_PERSONAL_WORK_CLEANUP,
  processAssetCleanup,
  processPersonalWorkCleanupJob,
} from '@/application/jobs/asset-cleanup';
import { type ContentParseJobData, JOB_CONTENT_PARSE, processContentParse } from '@/application/jobs/content-parse';
import { type DiscoverySyncJobData, JOB_DISCOVERY_SYNC, processDiscoverySync } from '@/application/jobs/discovery-sync';
import {
  JOB_METADATA_ENRICH,
  type MetadataEnrichJobData,
  processMetadataEnrich,
} from '@/application/jobs/metadata-enrich';
import {
  JOB_PART_AUDIO_GENERATE,
  type PartAudioGenerateJobData,
  processPartAudioGenerate,
} from '@/application/jobs/part-audio-generate';
import type { PingJobData } from '@/application/jobs/ping';
import { JOB_PING, processPing } from '@/application/jobs/ping';
import {
  JOB_SOURCE_RECORD_MATERIALIZE,
  processSourceRecordMaterialize,
  type SourceRecordMaterializeJobData,
} from '@/application/jobs/source-record-materialize';
import {
  JOB_METADATA_FILL,
  processWorkMetadataFill,
  type WorkMetadataFillJobData,
} from '@/application/jobs/work-metadata-fill';
import {
  dispatchQueuedPersonalTagRuns,
  finalizeFailedPersonalTagRun,
  JOB_PERSONAL_TAGGING,
  type PersonalTaggingJobData,
  processPersonalTaggingJob,
} from '@/domains/library/tags/personal-ai-tagging';
import type { PersonalWorkCleanupJobData } from '@/domains/works/personal/management';
import { commonEnv } from '@/infra/config/env-common';
import { workerLogger } from '@/infra/logging/logger';
import { CLEANUP_QUEUE_NAME, closeQueue, getQueueConnection, PERSONAL_TAG_QUEUE_NAME, QUEUE_NAME } from '@/infra/queue';

export const CLEANUP_WORKER_CONCURRENCY = 1;
export const PERSONAL_TAG_WORKER_CONCURRENCY = 2;

export async function processJob(job: Pick<Job, 'name' | 'data'>): Promise<unknown> {
  switch (job.name) {
    case JOB_PING:
      return processPing(job.data as PingJobData);
    case JOB_CONTENT_PARSE:
      return processContentParse(job.data as ContentParseJobData);
    case JOB_METADATA_FILL:
      return processWorkMetadataFill(job.data as WorkMetadataFillJobData);
    case JOB_METADATA_ENRICH:
      return processMetadataEnrich(job.data as MetadataEnrichJobData);
    case JOB_PART_AUDIO_GENERATE:
      return processPartAudioGenerate(job.data as PartAudioGenerateJobData);
    case JOB_DISCOVERY_SYNC:
      return processDiscoverySync(job.data as DiscoverySyncJobData);
    case JOB_SOURCE_RECORD_MATERIALIZE:
      return processSourceRecordMaterialize(job.data as SourceRecordMaterializeJobData);
    default:
      throw new Error(`Unknown job name: ${job.name}`);
  }
}

export async function processCleanupJob(job: Pick<Job, 'name' | 'data'>): Promise<unknown> {
  if (job.name === JOB_PERSONAL_WORK_CLEANUP) {
    return processPersonalWorkCleanupJob(job.data as PersonalWorkCleanupJobData);
  }
  if (job.name !== JOB_ASSET_CLEANUP) {
    throw new Error(`Unknown cleanup job name: ${job.name}`);
  }
  return processAssetCleanup(job.data as { jobId: string; scanId: string });
}

function attachWorkerEvents(worker: Worker, queue: string): void {
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

export function createWorkers(): { worker: Worker; cleanupWorker: Worker; personalTagWorker: Worker } {
  const connection = getQueueConnection();

  const worker = new BullWorker(QUEUE_NAME, async (job) => processJob(job), {
    connection,
  });
  const cleanupWorker = new BullWorker(CLEANUP_QUEUE_NAME, async (job) => processCleanupJob(job), {
    connection,
    concurrency: CLEANUP_WORKER_CONCURRENCY,
  });
  const personalTagWorker = new BullWorker(
    PERSONAL_TAG_QUEUE_NAME,
    async (job) => {
      if (job.name !== JOB_PERSONAL_TAGGING) throw new Error(`Unknown Personal tag job: ${job.name}`);
      return processPersonalTaggingJob(job.data as PersonalTaggingJobData);
    },
    { connection, concurrency: PERSONAL_TAG_WORKER_CONCURRENCY },
  );
  personalTagWorker.on('failed', (job) => {
    if (job && job.attemptsMade >= Number(job.opts.attempts ?? 1)) {
      void finalizeFailedPersonalTagRun(job.data as PersonalTaggingJobData).catch((error) => {
        workerLogger.warn({ err: error, jobId: job.id }, 'Failed to persist Personal tag run failure');
      });
    }
  });

  attachWorkerEvents(worker, QUEUE_NAME);
  attachWorkerEvents(cleanupWorker, CLEANUP_QUEUE_NAME);
  attachWorkerEvents(personalTagWorker, PERSONAL_TAG_QUEUE_NAME);

  return { worker, cleanupWorker, personalTagWorker };
}

async function main(): Promise<void> {
  const { worker, cleanupWorker, personalTagWorker } = createWorkers();
  let dispatcherRunning = false;
  const dispatch = async () => {
    if (dispatcherRunning) return;
    dispatcherRunning = true;
    try {
      await dispatchQueuedPersonalTagRuns();
    } catch (error) {
      workerLogger.warn({ err: error }, 'Personal tag outbox recovery pass failed');
    } finally {
      dispatcherRunning = false;
    }
  };
  void dispatch();
  const personalTagDispatchTimer = setInterval(() => void dispatch(), 60_000);
  personalTagDispatchTimer.unref?.();

  workerLogger.info(
    {
      queue: QUEUE_NAME,
      cleanupQueue: CLEANUP_QUEUE_NAME,
      personalTagQueue: PERSONAL_TAG_QUEUE_NAME,
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
    clearInterval(personalTagDispatchTimer);
    workerLogger.info({ signal }, 'Worker shutting down');
    await Promise.all([worker.close(), cleanupWorker.close(), personalTagWorker.close()]);
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
