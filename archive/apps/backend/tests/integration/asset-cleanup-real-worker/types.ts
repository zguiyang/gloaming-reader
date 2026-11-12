export type ScenarioStatus = 'PASS' | 'FAIL' | 'NOT RUN' | 'BLOCKED' | 'PARTIAL';

export type ScenarioResult = {
  id: 'A' | 'B' | 'C' | 'D';
  name: string;
  status: ScenarioStatus;
  observations: string[];
  evidence: string[];
  notRunReason?: string;
};

export type RedisCleanupReport = {
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

export type IntegrationReport = {
  finalVerdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'BLOCKED';
  realWorkerStarted: boolean;
  realBullmqUsed: boolean;
  realS3Deletes: boolean;
  testBucketPreserved: boolean;
  workerPid: number | null;
  scenarios: ScenarioResult[];
  createdObjectKeys: string[];
  workerDeletedObjectKeys: string[];
  teardownDeletedObjectKeys: string[];
  remainingPrefixKeys: string[];
  devBucketBefore: number;
  devBucketAfter: number;
  errors: string[];
  redis: RedisCleanupReport;
};

export type IsolatedEnv = {
  databaseUrl: string;
  redisUrl: string;
  s3Bucket: string;
  s3Endpoint: string;
  s3EndpointHost: string;
  queueName: string;
};
