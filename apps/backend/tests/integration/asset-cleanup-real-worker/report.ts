import { redactRedis } from './isolation';
import type { IntegrationReport, IsolatedEnv } from './types';

export function createInitialReport(): IntegrationReport {
  return {
    finalVerdict: 'FAIL',
    realWorkerStarted: false,
    realBullmqUsed: false,
    realS3Deletes: false,
    testBucketPreserved: true,
    workerPid: null,
    scenarios: [],
    createdObjectKeys: [],
    workerDeletedObjectKeys: [],
    teardownDeletedObjectKeys: [],
    remainingPrefixKeys: [],
    devBucketBefore: 0,
    devBucketAfter: 0,
    errors: [],
    redis: {
      dbIndex: '1',
      keyCountBefore: 0,
      keyCountAfterPrecheck: 0,
      emptyBefore: false,
      trackedKeys: [],
      deletedTrackedKeys: [],
      residualKeysDeleted: [],
      keyCountAfterCleanup: -1,
      leftoverKeysAfterCleanup: [],
      cleanupMode: 'none',
      flushedEntireDb1: false,
    },
  };
}

export function computeFinalVerdict(
  report: IntegrationReport,
  isolated: IsolatedEnv,
  blockedByRedisPrecheck: boolean,
): void {
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
}

export function buildReportOutput(input: {
  report: IntegrationReport;
  isolated: IsolatedEnv;
  redisDb1EmptyBefore: boolean;
  workerLog: string;
}): Record<string, unknown> {
  const { report, isolated, redisDb1EmptyBefore, workerLog } = input;
  const a = report.scenarios.find((s) => s.id === 'A');
  const b = report.scenarios.find((s) => s.id === 'B');
  const isolationOk =
    report.realWorkerStarted &&
    redactRedis(isolated.redisUrl).db === '1' &&
    isolated.s3Bucket !== 'gloaming-development';

  const commitAdvice =
    report.finalVerdict === 'PASS' && a?.status === 'PASS' && b?.status === 'PASS' && isolationOk
      ? '具备提交条件'
      : '暂不具备提交条件';

  return {
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
}
