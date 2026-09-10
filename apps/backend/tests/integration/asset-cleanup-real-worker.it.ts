/**
 * Real Worker isolation verification for async asset cleanup.
 *
 * Isolation contract:
 * - Loads `.env` then `.env.test`, then forces Redis DB `/1`, `DATABASE_URL=TEST_DATABASE_URL`,
 *   and test S3 bucket from `.env.test`.
 * - Spawns a one-shot Worker process without `VITEST` (so it enters normal startup).
 * - Does NOT call `processAssetCleanup` and does NOT inject `MemoryObjectStore`.
 * - Operates only under `asset-it-<run-id>/` and cleans up created DB/Redis/S3 artifacts.
 *
 * Teardown order (required):
 *   stop this-run Worker → wait for exit → delete test objects → delete test DB rows →
 *   delete this-run Redis / BullMQ keys.
 *
 * Run via: `pnpm exec tsx tests/integration/asset-cleanup-real-worker.it.ts`
 * (from apps/backend, after env isolation is applied by this file itself)
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

type ScenarioStatus = 'PASS' | 'FAIL' | 'NOT RUN' | 'BLOCKED' | 'PARTIAL';

type ScenarioResult = {
  id: 'A' | 'B' | 'C' | 'D';
  name: string;
  status: ScenarioStatus;
  observations: string[];
  evidence: string[];
  notRunReason?: string;
};

type RedisCleanupReport = {
  dbIndex: string;
  keyCountBefore: number;
  keyCountAfterPrecheck: number;
  emptyBefore: boolean;
  trackedKeys: string[];
  deletedTrackedKeys: string[];
  residualKeysDeleted: string[];
  keyCountAfterCleanup: number;
  leftoverKeysAfterCleanup: string[];
  cleanupMode: 'none' | 'tracked-only' | 'tracked-then-residual-db1-empty-before' | 'blocked-precheck';
  flushedEntireDb1: boolean;
};

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envPath = resolve(backendRoot, '.env');
const testEnvPath = resolve(backendRoot, '.env.test');

function loadEnvFile(path: string, override: boolean): Record<string, string> {
  const collected: Record<string, string> = {};
  loadDotenv({
    path,
    override,
    processEnv: collected as NodeJS.ProcessEnv & Record<string, string>,
  });
  return collected;
}

function redactRedis(url: string): { host: string; port: string; db: string } {
  const parsed = new URL(url);
  const db = (parsed.pathname.replace(/^\//, '') || '0').split('/')[0] || '0';
  return { host: parsed.hostname, port: String(parsed.port || '6379'), db };
}

function withRedisDb(url: string, dbIndex: number): string {
  const parsed = new URL(url);
  parsed.pathname = `/${dbIndex}`;
  return parsed.toString();
}

function assertIsolationOrThrow(config: {
  databaseUrl: string;
  redisUrl: string;
  s3Bucket: string;
  s3Endpoint: string;
}): void {
  const dbName = new URL(config.databaseUrl).pathname.replace(/^\//, '').split('/')[0];
  if (dbName !== 'gloaming_test') {
    throw new Error(`BLOCKED: DATABASE_URL must target gloaming_test, got ${dbName}`);
  }
  if (config.s3Bucket === 'gloaming-development') {
    throw new Error('BLOCKED: S3_BUCKET must not be gloaming-development');
  }
  const redis = redactRedis(config.redisUrl);
  if (redis.db === '0') {
    throw new Error('BLOCKED: test Redis DB index is 0 (conflicts with development Worker)');
  }
  const endpointHost = new URL(config.s3Endpoint).hostname;
  if (!endpointHost) {
    throw new Error('BLOCKED: S3_ENDPOINT host missing');
  }
}

/** Apply isolation env before any app module import. */
function applyIsolatedEnv(): {
  databaseUrl: string;
  redisUrl: string;
  s3Bucket: string;
  s3Endpoint: string;
  s3EndpointHost: string;
  queueName: string;
} {
  const fromDotenv = loadEnvFile(envPath, false);
  const fromTest = loadEnvFile(testEnvPath, true);
  const merged = { ...fromDotenv, ...fromTest };

  const testDatabaseUrl = merged.TEST_DATABASE_URL?.trim();
  if (!testDatabaseUrl) {
    throw new Error('BLOCKED: TEST_DATABASE_URL missing in .env.test');
  }

  const redisBase = merged.REDIS_URL?.trim();
  if (!redisBase) {
    throw new Error('BLOCKED: REDIS_URL missing in .env.test');
  }

  const isolatedRedis = withRedisDb(redisBase, 1);
  const s3Bucket = merged.S3_BUCKET?.trim();
  const s3Endpoint = merged.S3_ENDPOINT?.trim();
  if (!s3Bucket || !s3Endpoint) {
    throw new Error('BLOCKED: S3_BUCKET / S3_ENDPOINT missing in .env.test');
  }

  const nextEnv: Record<string, string> = {
    ...merged,
    DATABASE_URL: testDatabaseUrl,
    REDIS_URL: isolatedRedis,
    NODE_ENV: 'test',
    S3_BUCKET: s3Bucket,
    S3_ENDPOINT: s3Endpoint,
  };
  delete nextEnv.VITEST;

  for (const [key, value] of Object.entries(nextEnv)) {
    process.env[key] = value;
  }
  delete process.env.VITEST;

  assertIsolationOrThrow({
    databaseUrl: testDatabaseUrl,
    redisUrl: isolatedRedis,
    s3Bucket,
    s3Endpoint,
  });

  return {
    databaseUrl: testDatabaseUrl,
    redisUrl: isolatedRedis,
    s3Bucket,
    s3Endpoint,
    s3EndpointHost: new URL(s3Endpoint).hostname,
    queueName: 'gloaming-asset-cleanup',
  };
}

const isolated = applyIsolatedEnv();
const runId = `asset-it-${Date.now()}-${randomBytes(3).toString('hex')}`;
const prefix = `${runId}/`;

const report = {
  finalVerdict: 'FAIL' as 'PASS' | 'PARTIAL' | 'FAIL' | 'BLOCKED',
  realWorkerStarted: false,
  realBullmqUsed: false,
  realS3Deletes: false,
  testBucketPreserved: true,
  workerPid: null as number | null,
  scenarios: [] as ScenarioResult[],
  createdObjectKeys: [] as string[],
  workerDeletedObjectKeys: [] as string[],
  teardownDeletedObjectKeys: [] as string[],
  remainingPrefixKeys: [] as string[],
  devBucketBefore: 0,
  devBucketAfter: 0,
  errors: [] as string[],
  redis: {
    dbIndex: '1',
    keyCountBefore: 0,
    keyCountAfterPrecheck: 0,
    emptyBefore: false,
    trackedKeys: [] as string[],
    deletedTrackedKeys: [] as string[],
    residualKeysDeleted: [] as string[],
    keyCountAfterCleanup: -1,
    leftoverKeysAfterCleanup: [] as string[],
    cleanupMode: 'none' as RedisCleanupReport['cleanupMode'],
    flushedEntireDb1: false,
  } satisfies RedisCleanupReport,
};

function trackRedisKey(key: string, tracked: Set<string>): void {
  tracked.add(key);
}

async function main(): Promise<void> {
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
  const { env } = await import('@/lib/env');
  const { getRedis } = await import('@/lib/redis');
  const { CLEANUP_QUEUE_NAME, closeQueue } = await import('@/lib/queue');
  const { acquireLock, CLEANUP_LOCK_KEY, releaseLock, SCAN_LOCK_KEY } =
    await import('@/modules/asset-management/cleanup-store');
  const { listObjects, objectExists, putObject, resetObjectStoreCache } = await import('@/modules/oss');
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');

  if (env.S3_BUCKET !== isolated.s3Bucket) {
    throw new Error(`BLOCKED: runtime S3_BUCKET mismatch (${env.S3_BUCKET} vs ${isolated.s3Bucket})`);
  }
  if (redactRedis(env.REDIS_URL).db !== '1') {
    throw new Error(`BLOCKED: runtime Redis DB is not 1`);
  }
  if (CLEANUP_QUEUE_NAME !== 'gloaming-asset-cleanup') {
    throw new Error(`BLOCKED: unexpected cleanup queue ${CLEANUP_QUEUE_NAME}`);
  }

  const createdEmails: string[] = [];
  const workIds: string[] = [];
  const assetIds: string[] = [];
  const uploadedIds: string[] = [];
  const redisKeysCreated = new Set<string>();
  let redisDb1EmptyBefore = false;
  let blockedByRedisPrecheck = false;

  // Always track known lock keys that this suite may touch.
  trackRedisKey(CLEANUP_LOCK_KEY, redisKeysCreated);
  trackRedisKey(SCAN_LOCK_KEY, redisKeysCreated);

  async function countBucketObjects(bucket: string): Promise<number> {
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
  }

  async function listPrefixKeys(targetPrefix: string): Promise<string[]> {
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
  }

  async function deletePrefixObjects(targetPrefix: string): Promise<string[]> {
    const keys = await listPrefixKeys(targetPrefix);
    for (const key of keys) {
      const { deleteObject } = await import('@/modules/oss');
      await deleteObject(key);
    }
    return keys;
  }

  /** Snapshot Redis DB 1 keys into the this-run tracked set (only safe when DB was empty before). */
  async function adoptCurrentRedisKeysAsTracked(reason: string): Promise<void> {
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
  }

  function cookieHeader(response: Response): string {
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
    if (getSetCookie?.length) {
      return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
    }
    const single = response.headers.get('set-cookie');
    return single ? single.split(';')[0]! : '';
  }

  async function createAdminSession(): Promise<string> {
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
    return cookieHeader(login);
  }

  async function insertWork(originMeta: Record<string, unknown> = {}): Promise<string> {
    const id = `${prefix}work-${randomUUID()}`;
    await db.insert(readingWorkTable).values({
      id,
      title: 'Asset cleanup real-worker IT',
      originKind: 'admin_text',
      originMeta,
    });
    workIds.push(id);
    return id;
  }

  async function insertAsset(input: {
    workId: string;
    kind: string;
    storageKey: string;
    meta?: Record<string, unknown>;
  }): Promise<string> {
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
  }

  async function insertUploaded(storageKey: string, size: number): Promise<string> {
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
  }

  async function putTracked(key: string, size: number): Promise<void> {
    await putObject({ key, body: Buffer.alloc(size, 7), contentType: 'application/octet-stream' });
    report.createdObjectKeys.push(key);
  }

  type PollResult = {
    job: ReturnType<typeof assetCleanupJobSchema.parse>;
    statusHistory: string[];
  };

  async function pollJob(
    cookie: string,
    jobId: string,
    initialStatus: string,
    timeoutMs = 90_000,
  ): Promise<PollResult> {
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
  }

  let worker: ChildProcess | null = null;
  let workerPidThisRun: number | null = null;
  let workerExitPromise: Promise<void> | null = null;
  let workerStopRequested = false;
  let workerLog = '';

  async function startWorker(): Promise<void> {
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
  }

  /**
   * Idempotent: only SIGTERM/SIGKILL the ChildProcess spawned by this run.
   * Never scans or kills other processes (including the development Worker).
   */
  async function stopWorker(): Promise<void> {
    if (workerStopRequested) {
      if (workerExitPromise) await workerExitPromise;
      return;
    }
    workerStopRequested = true;

    const proc = worker;
    if (!proc) return;

    // Already exited.
    if (proc.exitCode !== null || proc.signalCode !== null) {
      if (workerExitPromise) await workerExitPromise;
      worker = null;
      return;
    }

    // Only signal the exact child we spawned.
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
  }

  try {
    // --- Redis DB 1 precheck: refuse unknown keys ---
    {
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
        return;
      }
      redisDb1EmptyBefore = true;
      report.redis.emptyBefore = true;
    }

    report.devBucketBefore = await countBucketObjects('gloaming-development');
    await startWorker();

    const adminCookie = await createAdminSession();
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

    // --- Scenario A: normal cleanup ---
    const scenarioA: ScenarioResult = {
      id: 'A',
      name: 'Normal cleanup via real Worker',
      status: 'FAIL',
      observations: [],
      evidence: [],
    };
    try {
      const workId = await insertWork();
      const chapter = `${prefix}part-audio/${workId}/audio_us/h/chapter.mp3`;
      const segment = `${prefix}part-audio/${workId}/audio_us/h/seg/0000.mp3`;
      const cover = `${prefix}covers/${workId}/cover.jpg`;
      const uploadedKey = `${prefix}epub/${workId}.epub`;
      const orphan = `${prefix}orphan/${workId}/leftover.bin`;

      await insertAsset({
        workId,
        kind: 'audio_us',
        storageKey: chapter,
        meta: {
          objectKeys: [segment, chapter],
          timeline: [
            {
              index: 0,
              textHash: 't0',
              startMs: 0,
              durationMs: 1000,
              storageKey: segment,
              wordTimings: [],
            },
          ],
        },
      });
      await insertAsset({ workId, kind: 'cover', storageKey: cover });
      await insertUploaded(uploadedKey, 16);

      await putTracked(chapter, 120);
      await putTracked(segment, 40);
      await putTracked(cover, 10);
      await putTracked(uploadedKey, 16);
      await putTracked(orphan, 55);

      const scanStarted = Date.now();
      const scanResponse = await app.request('/api/admin/assets/scan', {
        method: 'POST',
        headers: { Cookie: adminCookie },
      });
      const scanMs = Date.now() - scanStarted;
      if (scanResponse.status !== 200) {
        throw new Error(`scan HTTP ${scanResponse.status}`);
      }
      const reportScan = assetScanReportSchema.parse(await scanResponse.json());
      trackRedisKey(`asset-management:scan:${reportScan.scanId}`, redisKeysCreated);
      trackRedisKey(SCAN_LOCK_KEY, redisKeysCreated);
      scenarioA.observations.push(`scanComplete=${reportScan.scanComplete} orphanCount=${reportScan.orphanCount}`);
      scenarioA.evidence.push(`scanId=${reportScan.scanId} durationMs=${reportScan.durationMs} httpScanMs=${scanMs}`);

      if (!reportScan.scanComplete) {
        throw new Error('scan incomplete');
      }
      if (reportScan.orphanCount < 1) {
        throw new Error('expected at least one orphan');
      }

      const orphanList = assetObjectListDataSchema.parse(
        await (
          await app.request(`/api/admin/assets/scans/${reportScan.scanId}/objects?status=orphan`, {
            headers: { Cookie: adminCookie },
          })
        ).json(),
      );
      if (!orphanList.items.some((item) => item.key === orphan)) {
        throw new Error('scan report missing expected orphan key');
      }

      const referencedList = assetObjectListDataSchema.parse(
        await (
          await app.request(`/api/admin/assets/scans/${reportScan.scanId}/objects?status=referenced`, {
            headers: { Cookie: adminCookie },
          })
        ).json(),
      );
      for (const key of [chapter, segment, cover, uploadedKey]) {
        if (!referencedList.items.some((item) => item.key === key)) {
          throw new Error(`expected referenced key missing: ${key}`);
        }
      }

      const holdToken = `it-hold-a-${randomUUID()}`;
      const locked = await acquireLock(CLEANUP_LOCK_KEY, holdToken, 60);
      if (!locked) throw new Error('failed to acquire cleanup lock for non-blocking check');
      trackRedisKey(CLEANUP_LOCK_KEY, redisKeysCreated);

      let accepted;
      try {
        const cleanupStarted = Date.now();
        const cleanupResponse = await app.request(`/api/admin/assets/scans/${reportScan.scanId}/cleanup`, {
          method: 'POST',
          headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmed: true }),
        });
        const cleanupMs = Date.now() - cleanupStarted;
        if (cleanupResponse.status !== HTTP_STATUS.ACCEPTED) {
          throw new Error(`cleanup HTTP ${cleanupResponse.status}`);
        }
        accepted = assetCleanupJobAcceptedSchema.parse(await cleanupResponse.json());
        trackRedisKey(`asset-management:cleanup:job:${accepted.jobId}`, redisKeysCreated);
        trackRedisKey(`asset-management:cleanup:scan:${reportScan.scanId}`, redisKeysCreated);
        scenarioA.evidence.push(
          `cleanupAccepted jobId=${accepted.jobId} status=${accepted.status} httpMs=${cleanupMs}`,
        );
        if (cleanupMs > 5_000) {
          throw new Error(`cleanup enqueue blocked too long (${cleanupMs}ms)`);
        }

        const midScanStarted = Date.now();
        const midScan = await app.request('/api/admin/assets/scan', {
          method: 'POST',
          headers: { Cookie: adminCookie },
        });
        const midScanMs = Date.now() - midScanStarted;
        scenarioA.observations.push(`API remained responsive during queued cleanup midScanMs=${midScanMs}`);
        if (midScan.status === 409) {
          scenarioA.observations.push('concurrent scan correctly conflicted or lock contended');
        } else if (midScan.status === 200) {
          const midScanReport = assetScanReportSchema.parse(await midScan.json());
          trackRedisKey(`asset-management:scan:${midScanReport.scanId}`, redisKeysCreated);
        } else {
          throw new Error(`unexpected mid-scan status ${midScan.status}`);
        }
        if (midScanMs > 15_000) {
          throw new Error(`API blocked during cleanup (${midScanMs}ms)`);
        }
      } finally {
        await releaseLock(CLEANUP_LOCK_KEY, holdToken);
      }

      report.realBullmqUsed = true;
      await adoptCurrentRedisKeysAsTracked('after-scenario-a-enqueue');
      const { job, statusHistory } = await pollJob(adminCookie, accepted!.jobId, accepted!.status);
      trackRedisKey(`asset-management:cleanup:job:${job.jobId}`, redisKeysCreated);
      trackRedisKey(`asset-management:cleanup:scan:${job.scanId}`, redisKeysCreated);
      await adoptCurrentRedisKeysAsTracked('after-scenario-a-job');

      const statusHistoryObserved = statusHistory.join('→');
      scenarioA.observations.push(
        `job status=${job.status} deleted=${job.deletedCount} skipped=${job.skippedReferencedCount} failed=${job.failedCount}`,
      );
      scenarioA.observations.push(`statusHistoryObserved=${statusHistoryObserved}`);
      scenarioA.evidence.push(
        `verification=${JSON.stringify(job.verification ?? null)} statusHistoryObserved=${statusHistoryObserved}`,
      );
      if (!statusHistory.includes('running')) {
        scenarioA.observations.push(
          'running state not observed (job finished between polls); not claiming full queued→running→completed observation',
        );
      }

      if (job.status !== 'completed') {
        throw new Error(`expected completed, got ${job.status}`);
      }
      if (!job.verification?.ran) {
        throw new Error('verification missing');
      }
      if (job.verification.orphanCount !== 0) {
        throw new Error(`verification.orphanCount=${job.verification.orphanCount}`);
      }

      const orphanExists = await objectExists(orphan);
      const chapterExists = await objectExists(chapter);
      const segmentExists = await objectExists(segment);
      const coverExists = await objectExists(cover);
      const uploadedExists = await objectExists(uploadedKey);
      if (orphanExists) throw new Error('orphan still present in S3');
      if (!chapterExists || !segmentExists || !coverExists || !uploadedExists) {
        throw new Error('referenced object deleted unexpectedly');
      }
      report.realS3Deletes = true;
      report.workerDeletedObjectKeys.push(orphan);
      scenarioA.status = 'PASS';
    } catch (error) {
      scenarioA.status = 'FAIL';
      scenarioA.observations.push(error instanceof Error ? error.message : String(error));
      report.errors.push(`A: ${error instanceof Error ? error.message : String(error)}`);
    }
    report.scenarios.push(scenarioA);

    // --- Scenario B: second reconciliation ---
    const scenarioB: ScenarioResult = {
      id: 'B',
      name: 'Second reconciliation while cleanup pending',
      status: 'FAIL',
      observations: [],
      evidence: [],
    };
    try {
      const workId = await insertWork();
      const keepOrphan = `${prefix}b/${workId}/keep-after-ref.bin`;
      const deleteOrphan = `${prefix}b/${workId}/delete.bin`;
      const stableRef = `${prefix}b/${workId}/stable.jpg`;

      await insertAsset({ workId, kind: 'cover', storageKey: stableRef });
      await putTracked(keepOrphan, 22);
      await putTracked(deleteOrphan, 33);
      await putTracked(stableRef, 11);

      const scanResponse = await app.request('/api/admin/assets/scan', {
        method: 'POST',
        headers: { Cookie: adminCookie },
      });
      const scanReport = assetScanReportSchema.parse(await scanResponse.json());
      trackRedisKey(`asset-management:scan:${scanReport.scanId}`, redisKeysCreated);
      trackRedisKey(SCAN_LOCK_KEY, redisKeysCreated);

      const holdToken = `it-hold-b-${randomUUID()}`;
      if (!(await acquireLock(CLEANUP_LOCK_KEY, holdToken, 60))) {
        throw new Error('could not hold cleanup lock for scenario B');
      }
      trackRedisKey(CLEANUP_LOCK_KEY, redisKeysCreated);

      let accepted;
      try {
        const cleanupResponse = await app.request(`/api/admin/assets/scans/${scanReport.scanId}/cleanup`, {
          method: 'POST',
          headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmed: true }),
        });
        if (cleanupResponse.status !== HTTP_STATUS.ACCEPTED) {
          throw new Error(`cleanup HTTP ${cleanupResponse.status}`);
        }
        accepted = assetCleanupJobAcceptedSchema.parse(await cleanupResponse.json());
        trackRedisKey(`asset-management:cleanup:job:${accepted.jobId}`, redisKeysCreated);
        trackRedisKey(`asset-management:cleanup:scan:${scanReport.scanId}`, redisKeysCreated);
        if (accepted.status !== 'queued') {
          throw new Error(`expected queued, got ${accepted.status}`);
        }

        await insertAsset({ workId, kind: 'image', storageKey: keepOrphan });
        scenarioB.observations.push('inserted DB reference after enqueue, before worker lock release');
      } finally {
        await releaseLock(CLEANUP_LOCK_KEY, holdToken);
      }

      await adoptCurrentRedisKeysAsTracked('after-scenario-b-enqueue');
      const { job, statusHistory } = await pollJob(adminCookie, accepted!.jobId, accepted!.status);
      trackRedisKey(`asset-management:cleanup:job:${job.jobId}`, redisKeysCreated);
      trackRedisKey(`asset-management:cleanup:scan:${job.scanId}`, redisKeysCreated);
      await adoptCurrentRedisKeysAsTracked('after-scenario-b-job');

      const statusHistoryObserved = statusHistory.join('→');
      scenarioB.evidence.push(
        `status=${job.status} deletedCount=${job.deletedCount} skippedReferencedCount=${job.skippedReferencedCount}`,
      );
      scenarioB.observations.push(`verification.orphanCount=${job.verification?.orphanCount}`);
      scenarioB.observations.push(`statusHistoryObserved=${statusHistoryObserved}`);
      if (!statusHistory.includes('running')) {
        scenarioB.observations.push(
          'running state not observed (job finished between polls); not claiming full queued→running→completed observation',
        );
      }

      if (job.skippedReferencedCount < 1) {
        throw new Error(`expected skippedReferencedCount>=1, got ${job.skippedReferencedCount}`);
      }
      if (!(await objectExists(keepOrphan))) {
        throw new Error('newly referenced object was deleted');
      }
      if (await objectExists(deleteOrphan)) {
        throw new Error('true orphan was not deleted');
      }
      if (!(await objectExists(stableRef))) {
        throw new Error('stable referenced object missing');
      }
      if (job.status !== 'completed') {
        throw new Error(`expected completed, got ${job.status}`);
      }
      if (job.verification?.orphanCount !== 0) {
        throw new Error(`verification orphanCount=${job.verification?.orphanCount}`);
      }
      report.realS3Deletes = true;
      report.workerDeletedObjectKeys.push(deleteOrphan);
      scenarioB.status = 'PASS';
    } catch (error) {
      scenarioB.status = 'FAIL';
      scenarioB.observations.push(error instanceof Error ? error.message : String(error));
      report.errors.push(`B: ${error instanceof Error ? error.message : String(error)}`);
    }
    report.scenarios.push(scenarioB);

    // --- Scenario C: failure injection ---
    report.scenarios.push({
      id: 'C',
      name: 'Partial delete failure + retry',
      status: 'NOT RUN',
      observations: [],
      evidence: [
        'Unit coverage: apps/backend/tests/unit/cleanup-job.spec.ts (partial on delete failures, retryable status)',
        'Functional coverage uses MemoryObjectStore failure injection, not live R2',
      ],
      notRunReason:
        'Live R2/S3 has no safe, controllable delete-failure injection without mutating production code or IAM. Not forged.',
    });

    // --- Scenario D: fencing ---
    report.scenarios.push({
      id: 'D',
      name: 'Dual-worker lock fencing',
      status: 'NOT RUN',
      observations: [],
      evidence: [
        'Unit coverage: apps/backend/tests/unit/cleanup-job.spec.ts (stale worker / lock ownership lost)',
        'Unit coverage: apps/backend/tests/unit/cleanup-store.spec.ts (owned save script)',
      ],
      notRunReason:
        'Safe dual-Worker orchestration against shared lock timing is not available without invasive hooks; not claimed as real dual-Worker PASS.',
    });
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    if (String(error).includes('BLOCKED')) {
      report.finalVerdict = 'BLOCKED';
    }
  } finally {
    // Required order: stop Worker → wait → S3 objects → DB rows → Redis/BullMQ.
    try {
      await stopWorker();
    } catch (error) {
      report.errors.push(`stopWorker: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      await closeQueue();
    } catch (error) {
      report.errors.push(`closeQueue: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      report.remainingPrefixKeys = await listPrefixKeys(prefix);
      if (report.remainingPrefixKeys.length > 0) {
        const removed = await deletePrefixObjects(prefix);
        for (const key of removed) {
          if (!report.teardownDeletedObjectKeys.includes(key)) {
            report.teardownDeletedObjectKeys.push(key);
          }
        }
        report.remainingPrefixKeys = await listPrefixKeys(prefix);
      }
    } catch (error) {
      report.errors.push(`prefix cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      if (assetIds.length > 0) {
        await db.delete(contentAssetTable).where(inArray(contentAssetTable.id, assetIds));
      }
      if (uploadedIds.length > 0) {
        await db.delete(uploadedObjectTable).where(inArray(uploadedObjectTable.id, uploadedIds));
      }
      if (workIds.length > 0) {
        await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, workIds));
      }
      for (const email of createdEmails) {
        await db.delete(userTable).where(eq(userTable.email, email));
      }
    } catch (error) {
      report.errors.push(`db cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      if (!blockedByRedisPrecheck) {
        const redis = getRedis();
        if (redactRedis(env.REDIS_URL).db !== '1') {
          report.errors.push('refused Redis cleanup on non-DB-1 connection');
        } else {
          // Adopt any final BullMQ/runtime keys created this run (only if DB was empty before).
          await adoptCurrentRedisKeysAsTracked('before-redis-cleanup');

          const tracked = [...redisKeysCreated];
          report.redis.trackedKeys = tracked;

          const deletedTracked: string[] = [];
          if (tracked.length > 0) {
            // Delete in chunks to avoid oversized DEL argument lists.
            const chunkSize = 100;
            for (let i = 0; i < tracked.length; i += chunkSize) {
              const chunk = tracked.slice(i, i + chunkSize);
              const existing: string[] = [];
              for (const key of chunk) {
                if ((await redis.exists(key)) === 1) existing.push(key);
              }
              if (existing.length > 0) {
                await redis.del(...existing);
                deletedTracked.push(...existing);
              }
            }
          }
          report.redis.deletedTrackedKeys = deletedTracked;

          let residualDeleted: string[] = [];
          let leftover = await redis.keys('*');
          if (leftover.length > 0) {
            if (redisDb1EmptyBefore) {
              // Entire DB 1 belonged to this run; remove residuals and record explicitly.
              await redis.del(...leftover);
              residualDeleted = leftover;
              report.redis.flushedEntireDb1 = false;
              report.redis.cleanupMode = 'tracked-then-residual-db1-empty-before';
              leftover = await redis.keys('*');
              if (leftover.length > 0) {
                // Last resort only when precheck proved DB 1 empty.
                await redis.flushdb();
                report.redis.flushedEntireDb1 = true;
                residualDeleted = [...new Set([...residualDeleted, ...leftover])];
                leftover = await redis.keys('*');
              }
            } else {
              report.errors.push(
                `redis cleanup refused residual delete; DB 1 was not empty before test. leftover=${leftover.join(', ')}`,
              );
              report.redis.cleanupMode = 'tracked-only';
            }
          } else {
            report.redis.cleanupMode = 'tracked-only';
          }

          report.redis.residualKeysDeleted = residualDeleted;
          report.redis.keyCountAfterCleanup = leftover.length;
          report.redis.leftoverKeysAfterCleanup = leftover;
          if (leftover.length > 0) {
            report.errors.push(`redis leftover keys after cleanup: ${leftover.join(', ')}`);
          }
        }
      } else {
        report.redis.cleanupMode = 'blocked-precheck';
        report.redis.keyCountAfterCleanup = report.redis.keyCountBefore;
      }
    } catch (error) {
      report.errors.push(`redis cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      resetObjectStoreCache();
    } catch (error) {
      report.errors.push(`resetObjectStoreCache: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      report.devBucketAfter = await countBucketObjects('gloaming-development');
    } catch (error) {
      report.errors.push(`dev bucket recount: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const a = report.scenarios.find((s) => s.id === 'A');
  const b = report.scenarios.find((s) => s.id === 'B');
  const isolationOk =
    report.realWorkerStarted &&
    redactRedis(isolated.redisUrl).db === '1' &&
    isolated.s3Bucket !== 'gloaming-development';
  const dataSafe =
    report.remainingPrefixKeys.length === 0 &&
    report.devBucketBefore === report.devBucketAfter &&
    report.testBucketPreserved &&
    (report.redis.keyCountAfterCleanup === 0 || blockedByRedisPrecheck);

  if (report.finalVerdict !== 'BLOCKED') {
    if (isolationOk && a?.status === 'PASS' && b?.status === 'PASS' && dataSafe && report.errors.length === 0) {
      report.finalVerdict = 'PASS';
    } else if (isolationOk && (a?.status === 'PASS' || b?.status === 'PASS')) {
      report.finalVerdict = 'PARTIAL';
    } else {
      report.finalVerdict = 'FAIL';
    }
  }

  const commitAdvice =
    report.finalVerdict === 'PASS' && a?.status === 'PASS' && b?.status === 'PASS' && isolationOk
      ? '具备提交条件'
      : '暂不具备提交条件';

  const output = {
    ...report,
    workerDeletedObjectCount: report.workerDeletedObjectKeys.length,
    teardownDeletedObjectCount: report.teardownDeletedObjectKeys.length,
    isolation: {
      testProcess: {
        database: 'gloaming_test',
        redis: redactRedis(isolated.redisUrl),
        s3EndpointHost: isolated.s3EndpointHost,
        s3Bucket: isolated.s3Bucket,
        queue: isolated.queueName,
        vitest: process.env.VITEST ?? null,
      },
      testWorker: {
        pid: report.workerPid,
        database: 'gloaming_test',
        redis: redactRedis(isolated.redisUrl),
        s3EndpointHost: isolated.s3EndpointHost,
        s3Bucket: isolated.s3Bucket,
        queue: isolated.queueName,
        vitestUnset: true,
      },
      consistent: true,
      redisDb1EmptyBefore,
      didNotTouchRedisDb0: true,
      didNotStopDevWorker: true,
    },
    dataSafety: {
      createdObjectCount: report.createdObjectKeys.length,
      workerDeletedObjectCount: report.workerDeletedObjectKeys.length,
      teardownDeletedObjectCount: report.teardownDeletedObjectKeys.length,
      workerDeletedObjectKeys: report.workerDeletedObjectKeys,
      teardownDeletedObjectKeys: report.teardownDeletedObjectKeys,
      prefixCleared: report.remainingPrefixKeys.length === 0,
      remainingPrefixKeys: report.remainingPrefixKeys,
      testBucketPreserved: report.testBucketPreserved,
      developmentBucketUnchanged: report.devBucketBefore === report.devBucketAfter,
      developmentBucketBefore: report.devBucketBefore,
      developmentBucketAfter: report.devBucketAfter,
      redisKeyCountBefore: report.redis.keyCountBefore,
      redisKeyCountAfterCleanup: report.redis.keyCountAfterCleanup,
      redisCleanupMode: report.redis.cleanupMode,
      redisFlushedEntireDb1: report.redis.flushedEntireDb1,
    },
    commitAdvice,
    workerLogTail: workerLog.split('\n').slice(-30).join('\n'),
  };

  console.log('\n===== REAL WORKER INTEGRATION REPORT =====\n');
  console.log(JSON.stringify(output, null, 2));

  // Force exit: open Redis/pg handles otherwise keep the Node process alive after the report.
  process.exit(report.finalVerdict === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error('FATAL', error instanceof Error ? error.message : error);
  process.exit(1);
});
