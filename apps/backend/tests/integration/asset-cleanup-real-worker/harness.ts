import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { eq, inArray } from 'drizzle-orm';

import type { contentAsset, readingWork, uploadedObject, user } from '@gloaming/db';
import type {
  assetCleanupJobAcceptedSchema,
  assetCleanupJobSchema,
  assetObjectListDataSchema,
  assetScanReportSchema,
} from '@gloaming/shared/assets';
import type { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import type appDefault from '@/app';
import type { HTTP_STATUS } from '@/constants';
import type { db } from '@/db';
import type { commonEnv } from '@/lib/env-common';
import type { CLEANUP_QUEUE_NAME, closeQueue } from '@/lib/queue';
import type { getRedis } from '@/lib/redis';
import type { CLEANUP_LOCK_KEY } from '@/modules/asset-management/cleanup/store';
import type { acquireLock, releaseLock } from '@/modules/asset-management/lock-store';
import type { SCAN_LOCK_KEY } from '@/modules/asset-management/scan/config';
import type { listObjects, objectExists, putObject, resetObjectStoreCache } from '@/modules/oss';

import { backendRoot, redactRedis } from './isolation';
import type { IntegrationReport, IsolatedEnv } from './types';

export type AppDeps = {
  eq: typeof eq;
  inArray: typeof inArray;
  contentAssetTable: typeof contentAsset;
  readingWorkTable: typeof readingWork;
  uploadedObjectTable: typeof uploadedObject;
  userTable: typeof user;
  assetCleanupJobAcceptedSchema: typeof assetCleanupJobAcceptedSchema;
  assetCleanupJobSchema: typeof assetCleanupJobSchema;
  assetObjectListDataSchema: typeof assetObjectListDataSchema;
  assetScanReportSchema: typeof assetScanReportSchema;
  AUTH_ADMIN_ROLE: typeof AUTH_ADMIN_ROLE;
  app: typeof appDefault;
  HTTP_STATUS: typeof HTTP_STATUS;
  db: typeof db;
  env: typeof commonEnv;
  getRedis: typeof getRedis;
  CLEANUP_QUEUE_NAME: typeof CLEANUP_QUEUE_NAME;
  closeQueue: typeof closeQueue;
  acquireLock: typeof acquireLock;
  releaseLock: typeof releaseLock;
  CLEANUP_LOCK_KEY: typeof CLEANUP_LOCK_KEY;
  SCAN_LOCK_KEY: typeof SCAN_LOCK_KEY;
  listObjects: typeof listObjects;
  objectExists: typeof objectExists;
  putObject: typeof putObject;
  resetObjectStoreCache: typeof resetObjectStoreCache;
  S3Client: typeof S3Client;
  ListObjectsV2Command: typeof ListObjectsV2Command;
};

export async function loadAppDeps(): Promise<AppDeps> {
  const [
    { eq, inArray },
    {
      contentAsset: contentAssetTable,
      readingWork: readingWorkTable,
      uploadedObject: uploadedObjectTable,
      user: userTable,
    },
    { assetCleanupJobAcceptedSchema, assetCleanupJobSchema, assetObjectListDataSchema, assetScanReportSchema },
    { AUTH_ADMIN_ROLE },
  ] = await Promise.all([
    import('drizzle-orm'),
    import('@gloaming/db'),
    import('@gloaming/shared/assets'),
    import('@gloaming/shared/auth'),
  ]);

  const { default: app } = await import('@/app');
  const { HTTP_STATUS } = await import('@/constants');
  const { db } = await import('@/db');
  const { commonEnv: env } = await import('@/lib/env-common');
  const { getRedis } = await import('@/lib/redis');
  const { CLEANUP_QUEUE_NAME, closeQueue } = await import('@/lib/queue');
  const { acquireLock, releaseLock } = await import('@/modules/asset-management/lock-store');
  const { CLEANUP_LOCK_KEY } = await import('@/modules/asset-management/cleanup/store');
  const { SCAN_LOCK_KEY } = await import('@/modules/asset-management/scan/config');
  const { listObjects, objectExists, putObject, resetObjectStoreCache } = await import('@/modules/oss');
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');

  return {
    eq,
    inArray,
    contentAssetTable,
    readingWorkTable,
    uploadedObjectTable,
    userTable,
    assetCleanupJobAcceptedSchema,
    assetCleanupJobSchema,
    assetObjectListDataSchema,
    assetScanReportSchema,
    AUTH_ADMIN_ROLE,
    app,
    HTTP_STATUS,
    db,
    env,
    getRedis,
    CLEANUP_QUEUE_NAME,
    closeQueue,
    acquireLock,
    releaseLock,
    CLEANUP_LOCK_KEY,
    SCAN_LOCK_KEY,
    listObjects,
    objectExists,
    putObject,
    resetObjectStoreCache,
    S3Client,
    ListObjectsV2Command,
  };
}

export type RealWorkerHarness = {
  isolated: IsolatedEnv;
  runId: string;
  prefix: string;
  report: IntegrationReport;
  deps: AppDeps;
  createdEmails: string[];
  workIds: string[];
  assetIds: string[];
  uploadedIds: string[];
  redisKeysCreated: Set<string>;
  redisDb1EmptyBefore: boolean;
  blockedByRedisPrecheck: boolean;
  workerLog: string;
  trackRedisKey: (key: string) => void;
  countBucketObjects: (bucket: string) => Promise<number>;
  listPrefixKeys: (targetPrefix: string) => Promise<string[]>;
  deletePrefixObjects: (targetPrefix: string) => Promise<string[]>;
  adoptCurrentRedisKeysAsTracked: (reason: string) => Promise<void>;
  createAdminSession: () => Promise<string>;
  insertWork: (originMeta?: Record<string, unknown>) => Promise<string>;
  insertAsset: (input: {
    workId: string;
    kind: string;
    storageKey: string;
    meta?: Record<string, unknown>;
  }) => Promise<string>;
  insertUploaded: (storageKey: string, size: number) => Promise<string>;
  putTracked: (key: string, size: number) => Promise<void>;
  pollJob: (
    cookie: string,
    jobId: string,
    initialStatus: string,
    timeoutMs?: number,
  ) => Promise<{
    job: ReturnType<AppDeps['assetCleanupJobSchema']['parse']>;
    statusHistory: string[];
  }>;
  startWorker: () => Promise<void>;
  stopWorker: () => Promise<void>;
  runRedisDb1Precheck: () => Promise<boolean>;
  assertRuntimeIsolation: () => void;
  logIsolationBanner: () => void;
};

function trackRedisKey(key: string, tracked: Set<string>): void {
  tracked.add(key);
}

export function createHarness(input: {
  isolated: IsolatedEnv;
  runId: string;
  prefix: string;
  report: IntegrationReport;
  deps: AppDeps;
}): RealWorkerHarness {
  const { isolated, runId, prefix, report, deps } = input;
  const {
    eq,
    contentAssetTable,
    readingWorkTable,
    uploadedObjectTable,
    userTable,
    assetCleanupJobSchema,
    AUTH_ADMIN_ROLE,
    app,
    db,
    env,
    getRedis,
    CLEANUP_QUEUE_NAME,
    CLEANUP_LOCK_KEY,
    SCAN_LOCK_KEY,
    listObjects,
    putObject,
    S3Client,
    ListObjectsV2Command,
  } = deps;

  const createdEmails: string[] = [];
  const workIds: string[] = [];
  const assetIds: string[] = [];
  const uploadedIds: string[] = [];
  const redisKeysCreated = new Set<string>();
  let redisDb1EmptyBefore = false;
  let blockedByRedisPrecheck = false;

  trackRedisKey(CLEANUP_LOCK_KEY, redisKeysCreated);
  trackRedisKey(SCAN_LOCK_KEY, redisKeysCreated);

  let worker: ChildProcess | null = null;
  let workerPidThisRun: number | null = null;
  let workerExitPromise: Promise<void> | null = null;
  let workerStopRequested = false;
  let workerLog = '';

  const harness: RealWorkerHarness = {
    isolated,
    runId,
    prefix,
    report,
    deps,
    createdEmails,
    workIds,
    assetIds,
    uploadedIds,
    redisKeysCreated,
    get redisDb1EmptyBefore() {
      return redisDb1EmptyBefore;
    },
    set redisDb1EmptyBefore(value: boolean) {
      redisDb1EmptyBefore = value;
    },
    get blockedByRedisPrecheck() {
      return blockedByRedisPrecheck;
    },
    set blockedByRedisPrecheck(value: boolean) {
      blockedByRedisPrecheck = value;
    },
    get workerLog() {
      return workerLog;
    },
    trackRedisKey(key: string) {
      trackRedisKey(key, redisKeysCreated);
    },
    async countBucketObjects(bucket: string) {
      const client = new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        },
      });
      let token: string | undefined;
      let count = 0;
      do {
        const out = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }),
        );
        count += out.Contents?.length ?? 0;
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
      return count;
    },
    async listPrefixKeys(targetPrefix: string) {
      const keys: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await listObjects(targetPrefix, cursor);
        for (const object of page.objects) {
          keys.push(object.key);
        }
        if (!page.hasMore || !page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return keys;
    },
    async deletePrefixObjects(targetPrefix: string) {
      const keys = await harness.listPrefixKeys(targetPrefix);
      for (const key of keys) {
        const { deleteObject } = await import('@/modules/oss');
        await deleteObject(key);
      }
      return keys;
    },
    async adoptCurrentRedisKeysAsTracked(reason: string) {
      if (!redisDb1EmptyBefore) return;
      const redis = getRedis();
      const keys = await redis.keys('*');
      for (const key of keys) {
        trackRedisKey(key, redisKeysCreated);
      }
      if (keys.length > 0) {
        console.log(
          JSON.stringify({
            phase: 'redis-track',
            reason,
            adoptedCount: keys.length,
          }),
        );
      }
    },
    async createAdminSession() {
      const email = `asset-it-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const username = `asset_it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const password = 'password123';
      const signUp = await app.request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ email, password, name: 'Asset IT Admin', username }),
      });
      if (signUp.status !== 200) {
        throw new Error(`sign-up failed: ${signUp.status}`);
      }
      await db.update(userTable).set({ emailVerified: true, role: AUTH_ADMIN_ROLE }).where(eq(userTable.email, email));
      const login = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ email, password }),
      });
      if (login.status !== 200) {
        throw new Error(`sign-in failed: ${login.status}`);
      }
      createdEmails.push(email);
      const getSetCookie = (login.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
      if (getSetCookie?.length) {
        return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
      }
      const single = login.headers.get('set-cookie');
      return single ? single.split(';')[0]! : '';
    },
    async insertWork(originMeta: Record<string, unknown> = {}) {
      const id = `${prefix}work-${randomUUID()}`;
      await db.insert(readingWorkTable).values({
        id,
        title: 'Asset cleanup real-worker IT',
        originKind: 'admin_text',
        originMeta,
      });
      workIds.push(id);
      return id;
    },
    async insertAsset(input) {
      const id = `${prefix}asset-${randomUUID()}`;
      await db.insert(contentAssetTable).values({
        id,
        workId: input.workId,
        kind: input.kind,
        storageKey: input.storageKey,
        mimeType: 'application/octet-stream',
        contentHash: `hash-${id}`,
        meta: input.meta ?? {},
        status: 'ready',
      });
      assetIds.push(id);
      return id;
    },
    async insertUploaded(storageKey: string, size: number) {
      const id = `${prefix}up-${randomUUID()}`;
      await db.insert(uploadedObjectTable).values({
        id,
        contentHash: `hash-${id}`,
        storageKey,
        mimeType: 'application/epub+zip',
        size,
      });
      uploadedIds.push(id);
      return id;
    },
    async putTracked(key: string, size: number) {
      await putObject({ key, body: Buffer.alloc(size, 7), contentType: 'application/octet-stream' });
      report.createdObjectKeys.push(key);
    },
    async pollJob(cookie, jobId, initialStatus, timeoutMs = 90_000) {
      const started = Date.now();
      const statusHistory: string[] = [initialStatus];
      let lastStatus = initialStatus;
      while (Date.now() - started < timeoutMs) {
        const response = await app.request(`/api/admin/assets/cleanup-jobs/${encodeURIComponent(jobId)}`, {
          headers: { Cookie: cookie },
        });
        if (response.status !== 200) {
          throw new Error(`job poll HTTP ${response.status}`);
        }
        const job = assetCleanupJobSchema.parse(await response.json());
        if (job.status !== lastStatus) {
          statusHistory.push(job.status);
          lastStatus = job.status;
        }
        if (job.status === 'completed' || job.status === 'partial' || job.status === 'failed') {
          return { job, statusHistory };
        }
        await delay(500);
      }
      throw new Error(`job poll timeout; statusHistory=${statusHistory.join('→')}`);
    },
    async startWorker() {
      const childEnv = { ...process.env };
      delete childEnv.VITEST;
      worker = spawn('pnpm', ['exec', 'tsx', 'src/worker.ts'], {
        cwd: backendRoot,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      workerPidThisRun = worker.pid ?? null;
      report.workerPid = workerPidThisRun;

      workerExitPromise = new Promise<void>((resolvePromise) => {
        worker!.once('exit', () => {
          resolvePromise();
        });
      });

      await new Promise<void>((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          rejectPromise(new Error('Worker did not become ready in time'));
        }, 30_000);

        const onData = (chunk: Buffer) => {
          workerLog += chunk.toString('utf8');
          if (workerLog.includes('Worker listening')) {
            clearTimeout(timer);
            resolvePromise();
          }
        };
        worker!.stdout?.on('data', onData);
        worker!.stderr?.on('data', onData);
        worker!.once('exit', (code) => {
          clearTimeout(timer);
          rejectPromise(new Error(`Worker exited early with code ${code}`));
        });
      });
      report.realWorkerStarted = true;
    },
    async stopWorker() {
      if (workerStopRequested) {
        if (workerExitPromise) await workerExitPromise;
        return;
      }
      workerStopRequested = true;

      const proc = worker;
      if (!proc) return;

      if (proc.exitCode !== null || proc.signalCode !== null) {
        if (workerExitPromise) await workerExitPromise;
        worker = null;
        return;
      }

      if (workerPidThisRun !== null && proc.pid !== workerPidThisRun) {
        report.errors.push(
          `stopWorker refused: pid mismatch (tracked=${workerPidThisRun} current=${proc.pid ?? 'null'})`,
        );
        return;
      }

      await new Promise<void>((resolvePromise) => {
        const timer = setTimeout(() => {
          if (proc.exitCode === null && proc.signalCode === null) {
            proc.kill('SIGKILL');
          }
        }, 10_000);
        const finish = () => {
          clearTimeout(timer);
          resolvePromise();
        };
        if (workerExitPromise) {
          void workerExitPromise.then(finish);
        } else {
          proc.once('exit', finish);
        }
        proc.kill('SIGTERM');
      });

      if (workerExitPromise) await workerExitPromise;
      worker = null;
    },
    async runRedisDb1Precheck() {
      const redis = getRedis();
      if (redactRedis(env.REDIS_URL).db !== '1') {
        throw new Error('BLOCKED: Redis precheck refused non-DB-1 connection');
      }
      const keysBefore = await redis.keys('*');
      report.redis.keyCountBefore = keysBefore.length;
      report.redis.keyCountAfterPrecheck = keysBefore.length;
      if (keysBefore.length > 0) {
        blockedByRedisPrecheck = true;
        report.finalVerdict = 'BLOCKED';
        report.redis.emptyBefore = false;
        report.redis.cleanupMode = 'blocked-precheck';
        report.errors.push(
          `BLOCKED: Redis DB 1 has ${keysBefore.length} unexpected key(s); refuse to run. sample=${keysBefore
            .slice(0, 20)
            .join(', ')}`,
        );
        console.log(
          JSON.stringify(
            {
              phase: 'BLOCKED',
              reason: 'redis-db1-not-empty',
              keyCount: keysBefore.length,
              sampleKeys: keysBefore.slice(0, 20),
            },
            null,
            2,
          ),
        );
        return false;
      }
      redisDb1EmptyBefore = true;
      report.redis.emptyBefore = true;
      return true;
    },
    assertRuntimeIsolation() {
      if (env.S3_BUCKET !== isolated.s3Bucket) {
        throw new Error(`BLOCKED: runtime S3_BUCKET mismatch (${env.S3_BUCKET} vs ${isolated.s3Bucket})`);
      }
      if (redactRedis(env.REDIS_URL).db !== '1') {
        throw new Error(`BLOCKED: runtime Redis DB is not 1`);
      }
      if (CLEANUP_QUEUE_NAME !== 'gloaming-asset-cleanup') {
        throw new Error(`BLOCKED: unexpected cleanup queue ${CLEANUP_QUEUE_NAME}`);
      }
    },
    logIsolationBanner() {
      const redisMeta = redactRedis(env.REDIS_URL);
      console.log(
        JSON.stringify(
          {
            phase: 'isolation',
            runId,
            prefix,
            workerPid: report.workerPid,
            database: 'gloaming_test',
            redis: redisMeta,
            redisDb1EmptyBefore,
            s3EndpointHost: isolated.s3EndpointHost,
            s3Bucket: env.S3_BUCKET,
            queue: CLEANUP_QUEUE_NAME,
            nodeEnv: env.NODE_ENV,
            vitest: process.env.VITEST ?? null,
          },
          null,
          2,
        ),
      );
    },
  };

  return harness;
}
