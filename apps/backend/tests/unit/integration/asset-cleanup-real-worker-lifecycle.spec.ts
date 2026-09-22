import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps, RealWorkerHarness } from '../../integration/asset-cleanup-real-worker/harness';
import { createHarness } from '../../integration/asset-cleanup-real-worker/harness';
import * as harnessModule from '../../integration/asset-cleanup-real-worker/harness';
import { runRealWorkerIntegration } from '../../integration/asset-cleanup-real-worker/orchestrate';
import { createInitialReport } from '../../integration/asset-cleanup-real-worker/report';
import { runTeardown } from '../../integration/asset-cleanup-real-worker/teardown';
import type { IsolatedEnv } from '../../integration/asset-cleanup-real-worker/types';

const isolated: IsolatedEnv = {
  databaseUrl: 'postgresql://localhost/gloaming_test',
  redisUrl: 'redis://127.0.0.1:6379/1',
  s3Bucket: 'gloaming-test',
  s3Endpoint: 'https://example.r2.cloudflarestorage.com',
  s3EndpointHost: 'example.r2.cloudflarestorage.com',
  queueName: 'gloaming-asset-cleanup',
};

function makeTeardownDeps() {
  const closeRedis = vi.fn(async () => {});
  const closeQueue = vi.fn(async () => {});
  return {
    closeRedis,
    closeQueue,
    resetObjectStoreCache: vi.fn(),
    eq: vi.fn(),
    inArray: vi.fn(),
    contentAssetTable: {},
    readingWorkTable: {},
    uploadedObjectTable: {},
    userTable: {},
    db: { delete: vi.fn() },
    env: { REDIS_URL: isolated.redisUrl },
    getRedis: vi.fn(),
  };
}

function makeHarness(partial: {
  blocked: boolean;
  deps: ReturnType<typeof makeTeardownDeps>;
  report: ReturnType<typeof createInitialReport>;
}): RealWorkerHarness {
  const state = { blocked: partial.blocked };
  return {
    isolated,
    runId: 'asset-it-test',
    prefix: 'asset-it-test/',
    report: partial.report,
    deps: partial.deps as RealWorkerHarness['deps'],
    createdEmails: [],
    workIds: [],
    assetIds: [],
    uploadedIds: [],
    redisKeysCreated: new Set(),
    get redisDb1EmptyBefore() {
      return false;
    },
    set redisDb1EmptyBefore(_value: boolean) {},
    get blockedByRedisPrecheck() {
      return state.blocked;
    },
    set blockedByRedisPrecheck(value: boolean) {
      state.blocked = value;
    },
    workerLog: '',
    trackRedisKey: vi.fn(),
    countBucketObjects: vi.fn(),
    listPrefixKeys: vi.fn(),
    deletePrefixObjects: vi.fn(),
    adoptCurrentRedisKeysAsTracked: vi.fn(),
    createAdminSession: vi.fn(),
    insertWork: vi.fn(),
    insertAsset: vi.fn(),
    insertUploaded: vi.fn(),
    putTracked: vi.fn(),
    pollJob: vi.fn(),
    startWorker: vi.fn(),
    stopWorker: vi.fn(async () => {}),
    runRedisDb1Precheck: vi.fn(),
    assertRuntimeIsolation: vi.fn(),
    logIsolationBanner: vi.fn(),
  };
}

function makeMinimalAppDeps(redis: { keys: ReturnType<typeof vi.fn> }): AppDeps {
  const base = makeTeardownDeps();
  return {
    ...base,
    getRedis: () => redis as ReturnType<AppDeps['getRedis']>,
    inArray: vi.fn(),
    contentAssetTable: {} as AppDeps['contentAssetTable'],
    readingWorkTable: {} as AppDeps['readingWorkTable'],
    uploadedObjectTable: {} as AppDeps['uploadedObjectTable'],
    userTable: {} as AppDeps['userTable'],
    assetCleanupJobAcceptedSchema: {} as AppDeps['assetCleanupJobAcceptedSchema'],
    assetCleanupJobSchema: {} as AppDeps['assetCleanupJobSchema'],
    assetObjectListDataSchema: {} as AppDeps['assetObjectListDataSchema'],
    assetScanReportSchema: {} as AppDeps['assetScanReportSchema'],
    AUTH_ADMIN_ROLE: 'admin' as AppDeps['AUTH_ADMIN_ROLE'],
    app: {} as AppDeps['app'],
    HTTP_STATUS: {} as AppDeps['HTTP_STATUS'],
    CLEANUP_QUEUE_NAME: 'gloaming-asset-cleanup',
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    CLEANUP_LOCK_KEY: 'cleanup-lock' as AppDeps['CLEANUP_LOCK_KEY'],
    SCAN_LOCK_KEY: 'scan-lock' as AppDeps['SCAN_LOCK_KEY'],
    listObjects: vi.fn(),
    objectExists: vi.fn(),
    putObject: vi.fn(),
    S3Client: class {} as AppDeps['S3Client'],
    ListObjectsV2Command: class {} as AppDeps['ListObjectsV2Command'],
  } as AppDeps;
}

describe('asset-cleanup real worker harness lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runRedisDb1Precheck returns BLOCKED when KEYS fails without mutating Redis', async () => {
    const report = createInitialReport();
    const redis = {
      keys: vi.fn().mockRejectedValue(new Error('ECONNRESET')),
      del: vi.fn(),
      flushdb: vi.fn(),
    };
    const harness = createHarness({
      isolated,
      runId: 'asset-it-precheck',
      prefix: 'asset-it-precheck/',
      report,
      deps: makeMinimalAppDeps(redis),
    });

    const ok = await harness.runRedisDb1Precheck();

    expect(ok).toBe(false);
    expect(harness.blockedByRedisPrecheck).toBe(true);
    expect(report.finalVerdict).toBe('BLOCKED');
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.flushdb).not.toHaveBeenCalled();
  });

  it('runRedisDb1Precheck returns BLOCKED when KEYS times out', async () => {
    vi.useFakeTimers();
    const report = createInitialReport();
    const redis = {
      keys: vi.fn(() => new Promise(() => {})),
      del: vi.fn(),
    };
    const harness = createHarness({
      isolated,
      runId: 'asset-it-precheck-timeout',
      prefix: 'asset-it-precheck-timeout/',
      report,
      deps: makeMinimalAppDeps(redis),
    });

    const pending = harness.runRedisDb1Precheck();
    await vi.advanceTimersByTimeAsync(5_000);
    const ok = await pending;

    expect(ok).toBe(false);
    expect(report.finalVerdict).toBe('BLOCKED');
    expect(redis.del).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('runTeardown on blocked precheck closes queue and cache Redis without deleting keys', async () => {
    const report = createInitialReport();
    report.finalVerdict = 'BLOCKED';
    report.redis.keyCountBefore = 4;
    const deps = makeTeardownDeps();
    const harness = makeHarness({ blocked: true, deps, report });

    await runTeardown(harness);

    expect(deps.closeQueue).toHaveBeenCalledTimes(1);
    expect(deps.closeRedis).toHaveBeenCalledTimes(1);
    expect(deps.getRedis).not.toHaveBeenCalled();
    expect(report.redis.cleanupMode).toBe('blocked-precheck');
    expect(report.redis.keyCountAfterCleanup).toBe(4);
  });

  it('runTeardown on normal path closes cache Redis after cleanup', async () => {
    const report = createInitialReport();
    const deps = makeTeardownDeps();
    const redis = {
      exists: vi.fn(async () => 0),
      del: vi.fn(),
      keys: vi.fn(async () => []),
      flushdb: vi.fn(),
    };
    deps.getRedis.mockReturnValue(redis);
    const harness = makeHarness({ blocked: false, deps, report });
    harness.listPrefixKeys = vi.fn(async () => []);
    harness.countBucketObjects = vi.fn(async () => 0);
    harness.adoptCurrentRedisKeysAsTracked = vi.fn(async () => {});

    await runTeardown(harness);

    expect(deps.closeRedis).toHaveBeenCalledTimes(1);
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.flushdb).not.toHaveBeenCalled();
  });

  it('returns BLOCKED report and non-zero exit when Redis precheck refuses to run', async () => {
    const report = createInitialReport();
    const deps = makeTeardownDeps();
    const harness = makeHarness({ blocked: false, deps, report });
    harness.runRedisDb1Precheck = vi.fn(async () => {
      harness.blockedByRedisPrecheck = true;
      report.finalVerdict = 'BLOCKED';
      report.redis.keyCountBefore = 2;
      report.redis.cleanupMode = 'blocked-precheck';
      return false;
    });

    vi.spyOn(harnessModule, 'createHarness').mockReturnValue(harness);

    const { output, exitCode } = await runRealWorkerIntegration({
      isolated,
      runId: 'asset-it-test',
      prefix: 'asset-it-test/',
      report,
      deps: deps as RealWorkerHarness['deps'],
    });

    expect(harness.runRedisDb1Precheck).toHaveBeenCalledTimes(1);
    expect(harness.startWorker).not.toHaveBeenCalled();
    expect(output.finalVerdict).toBe('BLOCKED');
    expect(exitCode).toBe(1);
    expect(deps.closeRedis).toHaveBeenCalledTimes(1);
  });
});
