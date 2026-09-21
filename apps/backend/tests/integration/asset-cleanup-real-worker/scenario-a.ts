import { randomUUID } from 'node:crypto';

import type { RealWorkerHarness } from './harness';
import type { ScenarioResult } from './types';

export async function runScenarioA(harness: RealWorkerHarness, adminCookie: string): Promise<ScenarioResult> {
  const { prefix, report, deps, trackRedisKey } = harness;
  const {
    app,
    HTTP_STATUS,
    assetScanReportSchema,
    assetObjectListDataSchema,
    assetCleanupJobAcceptedSchema,
    CLEANUP_LOCK_KEY,
    SCAN_LOCK_KEY,
    acquireLock,
    releaseLock,
    objectExists,
  } = deps;

  const scenarioA: ScenarioResult = {
    id: 'A',
    name: 'Normal cleanup via real Worker',
    status: 'FAIL',
    observations: [],
    evidence: [],
  };

  try {
    const workId = await harness.insertWork();
    const chapter = `${prefix}part-audio/${workId}/audio_us/h/chapter.mp3`;
    const segment = `${prefix}part-audio/${workId}/audio_us/h/seg/0000.mp3`;
    const cover = `${prefix}covers/${workId}/cover.jpg`;
    const uploadedKey = `${prefix}epub/${workId}.epub`;
    const orphan = `${prefix}orphan/${workId}/leftover.bin`;

    await harness.insertAsset({
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
    await harness.insertAsset({ workId, kind: 'cover', storageKey: cover });
    await harness.insertUploaded(uploadedKey, 16);

    await harness.putTracked(chapter, 120);
    await harness.putTracked(segment, 40);
    await harness.putTracked(cover, 10);
    await harness.putTracked(uploadedKey, 16);
    await harness.putTracked(orphan, 55);

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
    trackRedisKey(`asset-management:scan:${reportScan.scanId}`);
    trackRedisKey(SCAN_LOCK_KEY);
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
    trackRedisKey(CLEANUP_LOCK_KEY);

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
      trackRedisKey(`asset-management:cleanup:job:${accepted.jobId}`);
      trackRedisKey(`asset-management:cleanup:scan:${reportScan.scanId}`);
      scenarioA.evidence.push(`cleanupAccepted jobId=${accepted.jobId} status=${accepted.status} httpMs=${cleanupMs}`);
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
        trackRedisKey(`asset-management:scan:${midScanReport.scanId}`);
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
    await harness.adoptCurrentRedisKeysAsTracked('after-scenario-a-enqueue');
    const { job, statusHistory } = await harness.pollJob(adminCookie, accepted!.jobId, accepted!.status);
    trackRedisKey(`asset-management:cleanup:job:${job.jobId}`);
    trackRedisKey(`asset-management:cleanup:scan:${job.scanId}`);
    await harness.adoptCurrentRedisKeysAsTracked('after-scenario-a-job');

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

  return scenarioA;
}
