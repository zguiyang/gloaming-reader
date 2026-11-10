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
 * Run via: `pnpm test:integration:worker` (from apps/backend) or
 * `pnpm test:backend:integration` (from repo root). Env isolation is applied by this harness.
 */
import { randomBytes } from 'node:crypto';

import { loadAppDeps } from './harness';
import { applyIsolatedEnv } from './isolation';
import { runRealWorkerIntegration } from './orchestrate';
import { createInitialReport } from './report';

const isolated = applyIsolatedEnv();
const runId = `asset-it-${Date.now()}-${randomBytes(3).toString('hex')}`;
const prefix = `${runId}/`;
const report = createInitialReport();

async function main(): Promise<void> {
  const deps = await loadAppDeps();
  const { output, exitCode } = await runRealWorkerIntegration({
    isolated,
    runId,
    prefix,
    report,
    deps,
  });

  console.log('\n===== REAL WORKER INTEGRATION REPORT =====\n');
  console.log(JSON.stringify(output, null, 2));

  process.exit(exitCode);
}

main().catch((error) => {
  console.error('FATAL', error instanceof Error ? error.message : error);
  process.exit(1);
});
