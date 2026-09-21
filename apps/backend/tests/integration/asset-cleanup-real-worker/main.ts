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
 * Run via: `pnpm exec tsx tests/integration/asset-cleanup-real-worker/main.ts`
 * (from apps/backend, after env isolation is applied by this harness itself)
 */
import { randomBytes } from 'node:crypto';

import { createHarness, loadAppDeps } from './harness';
import { applyIsolatedEnv } from './isolation';
import { buildReportOutput, computeFinalVerdict, createInitialReport } from './report';
import { runScenarioA } from './scenario-a';
import { runScenarioB } from './scenario-b';
import { scenarioCNotRun, scenarioDNotRun } from './scenarios-not-run';
import { runTeardown } from './teardown';

const isolated = applyIsolatedEnv();
const runId = `asset-it-${Date.now()}-${randomBytes(3).toString('hex')}`;
const prefix = `${runId}/`;
const report = createInitialReport();

async function main(): Promise<void> {
  const deps = await loadAppDeps();
  const harness = createHarness({ isolated, runId, prefix, report, deps });

  harness.assertRuntimeIsolation();

  try {
    const canRun = await harness.runRedisDb1Precheck();
    if (!canRun) {
      return;
    }

    report.devBucketBefore = await harness.countBucketObjects('gloaming-development');
    await harness.startWorker();

    const adminCookie = await harness.createAdminSession();
    harness.logIsolationBanner();

    report.scenarios.push(await runScenarioA(harness, adminCookie));
    report.scenarios.push(await runScenarioB(harness, adminCookie));
    report.scenarios.push(scenarioCNotRun());
    report.scenarios.push(scenarioDNotRun());
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    if (String(error).includes('BLOCKED')) {
      report.finalVerdict = 'BLOCKED';
    }
  } finally {
    await runTeardown(harness);
  }

  computeFinalVerdict(report, isolated, harness.blockedByRedisPrecheck);

  const output = buildReportOutput({
    report,
    isolated,
    redisDb1EmptyBefore: harness.redisDb1EmptyBefore,
    workerLog: harness.workerLog,
  });

  console.log('\n===== REAL WORKER INTEGRATION REPORT =====\n');
  console.log(JSON.stringify(output, null, 2));

  process.exit(report.finalVerdict === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error('FATAL', error instanceof Error ? error.message : error);
  process.exit(1);
});
