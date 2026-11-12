import type { Job, Worker } from 'bullmq';
import { Worker as BullWorker } from 'bullmq';

import { JOB_ASSET_CLEANUP, processAssetCleanup } from '@/jobs/asset-cleanup';
import { type ContentParseJobData, JOB_CONTENT_PARSE, processContentParse } from '@/jobs/content-parse';
import { JOB_METADATA_ENRICH, type MetadataEnrichJobData, processMetadataEnrich } from '@/jobs/metadata-enrich';
import type { PingJobData } from '@/jobs/ping';
import { JOB_PING, processPing } from '@/jobs/ping';
import {
  JOB_PUBLIC_CLASSIFICATION,
  processPublicClassification,
  type PublicClassificationJobData,
} from '@/jobs/public-classification';
import {
  JOB_SOURCE_RECORD_MATERIALIZE,
  processSourceRecordMaterialize,
  type SourceRecordMaterializeJobData,
} from '@/jobs/source-record-materialize';
import {
  JOB_WORK_COVER_REFRESH,
  processWorkCoverRefresh,
  type WorkCoverRefreshJobData,
} from '@/jobs/work-cover-refresh';
import { JOB_METADATA_FILL, processWorkMetadataFill, type WorkMetadataFillJobData } from '@/jobs/work-metadata-fill';
import { dispatchDuePublicClassifications } from '@/server/domains/discovery/categories';
import { recoverStaleSaveIntents } from '@/server/domains/library/save-intent';
import { commonEnv } from '@/server/infra/config/env-common';
import { workerLogger } from '@/server/infra/logging/logger';
import {
  CLEANUP_QUEUE_NAME,
  closeQueue,
  DISCOVERY_IMPORT_QUEUE_NAME,
  getQueueConnection,
  PUBLIC_CLASSIFICATION_QUEUE_NAME,
  QUEUE_NAME,
} from '@/server/infra/queue';

export const CLEANUP_WORKER_CONCURRENCY = 1;
export const PUBLIC_CLASSIFICATION_WORKER_CONCURRENCY = 1;

export const PUBLIC_CLASSIFICATION_ONLY_FLAG = '--public-classification-only';
export const DISCOVERY_IMPORT_ONLY_FLAG = '--discovery-import-only';
export const NO_PUBLIC_CLASSIFICATION_FLAG = '--no-public-classification';

export type WorkerMode = 'full' | 'public-classification-only' | 'discovery-import-only';

export function resolveWorkerMode(argv: readonly string[] = process.argv): WorkerMode {
  if (argv.includes(DISCOVERY_IMPORT_ONLY_FLAG)) return 'discovery-import-only';
  return argv.includes(PUBLIC_CLASSIFICATION_ONLY_FLAG) ? 'public-classification-only' : 'full';
}

export function publicClassificationEnabled(mode: WorkerMode, argv: readonly string[] = process.argv): boolean {
  if (!argv.includes(NO_PUBLIC_CLASSIFICATION_FLAG)) return true;
  if (mode !== 'full') throw new Error(`${NO_PUBLIC_CLASSIFICATION_FLAG} is only supported in full worker mode`);
  return false;
}

export async function dispatchPublicClassificationsIfEnabled(
  enabled: boolean,
  dispatch: typeof dispatchDuePublicClassifications = dispatchDuePublicClassifications,
): Promise<void> {
  if (enabled) await dispatch();
}

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
    case JOB_SOURCE_RECORD_MATERIALIZE:
      return processSourceRecordMaterialize(job.data as SourceRecordMaterializeJobData);
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

export async function processDiscoveryImportJob(job: Pick<Job, 'name' | 'data'>): Promise<unknown> {
  if (job.name === JOB_SOURCE_RECORD_MATERIALIZE) {
    return processSourceRecordMaterialize(job.data as SourceRecordMaterializeJobData);
  }
  if (job.name === JOB_CONTENT_PARSE) {
    const data = job.data as ContentParseJobData;
    if (data.processingLane !== 'discovery') {
      throw new Error('Discovery import content-parse job is missing its discovery processing lane');
    }
    return processContentParse(data);
  }
  throw new Error(`Unknown discovery import job: ${job.name}`);
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

export function createWorkers(
  mode: WorkerMode = 'full',
  options: {
    discoveryImportQueueName?: string;
    publicClassificationEnabled?: boolean;
  } = {},
): {
  worker?: Worker;
  cleanupWorker?: Worker;
  publicClassificationWorker?: Worker;
  discoveryImportWorker?: Worker;
} {
  const connection = getQueueConnection();
  const discoveryImportQueueName = options.discoveryImportQueueName ?? DISCOVERY_IMPORT_QUEUE_NAME;

  const createPublicClassificationWorker = () => {
    const publicClassificationWorker = new BullWorker(
      PUBLIC_CLASSIFICATION_QUEUE_NAME,
      async (job) => {
        if (job.name !== JOB_PUBLIC_CLASSIFICATION) throw new Error(`Unknown public classification job: ${job.name}`);
        return processPublicClassification(job.data as PublicClassificationJobData);
      },
      { connection, concurrency: PUBLIC_CLASSIFICATION_WORKER_CONCURRENCY },
    );
    attachWorkerEvents(publicClassificationWorker, PUBLIC_CLASSIFICATION_QUEUE_NAME);
    return publicClassificationWorker;
  };

  const createDiscoveryImportWorker = () => {
    const discoveryImportWorker = new BullWorker(
      discoveryImportQueueName,
      async (job) => processDiscoveryImportJob(job),
      { connection },
    );
    attachWorkerEvents(discoveryImportWorker, discoveryImportQueueName);
    return discoveryImportWorker;
  };

  if (mode === 'public-classification-only') {
    return { publicClassificationWorker: createPublicClassificationWorker() };
  }

  if (mode === 'discovery-import-only') {
    return { discoveryImportWorker: createDiscoveryImportWorker() };
  }

  const worker = new BullWorker(QUEUE_NAME, async (job) => processJob(job), {
    connection,
  });
  const cleanupWorker = new BullWorker(CLEANUP_QUEUE_NAME, async (job) => processCleanupJob(job), {
    connection,
    concurrency: CLEANUP_WORKER_CONCURRENCY,
  });

  attachWorkerEvents(worker, QUEUE_NAME);
  attachWorkerEvents(cleanupWorker, CLEANUP_QUEUE_NAME);

  const publicClassificationWorker =
    options.publicClassificationEnabled === false ? undefined : createPublicClassificationWorker();
  const discoveryImportWorker = createDiscoveryImportWorker();

  return { worker, cleanupWorker, publicClassificationWorker, discoveryImportWorker };
}

async function main(): Promise<void> {
  const mode = resolveWorkerMode();
  const classificationEnabled = publicClassificationEnabled(mode);
  const publicClassificationOnly = mode === 'public-classification-only';
  const { worker, cleanupWorker, publicClassificationWorker, discoveryImportWorker } = createWorkers(mode, {
    publicClassificationEnabled: classificationEnabled,
  });
  if (mode === 'discovery-import-only') {
    workerLogger.info({ queue: DISCOVERY_IMPORT_QUEUE_NAME, mode }, 'Worker listening');
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      workerLogger.info({ signal }, 'Worker shutting down');
      await discoveryImportWorker?.close();
      await closeQueue();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    return;
  }
  let dispatcherRunning = false;
  const dispatch = async () => {
    if (dispatcherRunning) return;
    dispatcherRunning = true;
    if (!publicClassificationOnly) {
      try {
        // Bounded stale Save Intent recovery: re-queue lost materialization
        // jobs and time out intents whose deadline passed (see save-intent).
        await recoverStaleSaveIntents();
      } catch (error) {
        workerLogger.warn({ err: error }, 'Save intent recovery pass failed');
      }
    }
    try {
      await dispatchPublicClassificationsIfEnabled(classificationEnabled);
    } catch (error) {
      workerLogger.warn({ err: error }, 'Public classification outbox recovery pass failed');
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
      discoveryImportQueue: DISCOVERY_IMPORT_QUEUE_NAME,
      cleanupQueue: CLEANUP_QUEUE_NAME,
      nodeEnv: commonEnv.NODE_ENV,
      mode,
      publicClassificationEnabled: classificationEnabled,
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
    await Promise.all(
      [worker, cleanupWorker, publicClassificationWorker, discoveryImportWorker]
        .filter((created): created is Worker => created !== undefined)
        .map((created) => created.close()),
    );
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
