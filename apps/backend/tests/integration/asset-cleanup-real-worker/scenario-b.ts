import { randomUUID } from 'node:crypto';

import type { RealWorkerHarness } from './harness';
import type { ScenarioResult } from './types';

export async function runScenarioB(harness: RealWorkerHarness, adminCookie: string): Promise<ScenarioResult> {
  const { prefix, report, deps, trackRedisKey } = harness;
  const {
    app,
    HTTP_STATUS,
    assetScanReportSchema,
    assetCleanupJobAcceptedSchema,
    CLEANUP_LOCK_KEY,
    SCAN_LOCK_KEY,
    acquireLock,
    releaseLock,
    objectExists,
  } = deps;

  const scenarioB: ScenarioResult = {
    id: 'B',
    name: 'Second reconciliation while cleanup pending',
    status: 'FAIL',
    observations: [],
    evidence: [],
  };

  try {
    const workId = await harness.insertWork();
    const keepOrphan = `${prefix}b/${workId}/keep-after-ref.bin`;
    const deleteOrphan = `${prefix}b/${workId}/delete.bin`;
    const stableRef = `${prefix}b/${workId}/stable.jpg`;

    await harness.insertAsset({ workId, kind: 'cover', storageKey: stableRef });
    await harness.putTracked(keepOrphan, 22);
    await harness.putTracked(deleteOrphan, 33);
    await harness.putTracked(stableRef, 11);

    const scanResponse = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    const scanReport = assetScanReportSchema.parse(await scanResponse.json());
    trackRedisKey(`asset-management:scan:${scanReport.scanId}`);
    trackRedisKey(SCAN_LOCK_KEY);

    const holdToken = `it-hold-b-${randomUUID()}`;
    if (!(await acquireLock(CLEANUP_LOCK_KEY, holdToken, 60))) {
      throw new Error('could not hold cleanup lock for scenario B');
    }
    trackRedisKey(CLEANUP_LOCK_KEY);

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
      trackRedisKey(`asset-management:cleanup:job:${accepted.jobId}`);
      trackRedisKey(`asset-management:cleanup:scan:${scanReport.scanId}`);
      if (accepted.status !== 'queued') {
        throw new Error(`expected queued, got ${accepted.status}`);
      }

      await harness.insertAsset({ workId, kind: 'image', storageKey: keepOrphan });
      scenarioB.observations.push('inserted DB reference after enqueue, before worker lock release');
    } finally {
      await releaseLock(CLEANUP_LOCK_KEY, holdToken);
    }

    await harness.adoptCurrentRedisKeysAsTracked('after-scenario-b-enqueue');
    const { job, statusHistory } = await harness.pollJob(adminCookie, accepted!.jobId, accepted!.status);
    trackRedisKey(`asset-management:cleanup:job:${job.jobId}`);
    trackRedisKey(`asset-management:cleanup:scan:${job.scanId}`);
    await harness.adoptCurrentRedisKeysAsTracked('after-scenario-b-job');

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

  return scenarioB;
}
