import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
} from '@gloaming/db';

import app from '@/app';
import { db } from '@/db';
import {
  computeMigratedAudioMetadata,
  runLegacyMetadataMigration,
} from '@/modules/asset-management/legacy-metadata-migration';
import { runLegacySegmentCleanup } from '@/modules/asset-management/legacy-segment-cleanup';
import { setObjectStoreForTests } from '@/modules/oss';

import { createMemoryObjectStore } from '../helpers/memory-oss';

describe('legacy audio migration to cleanup pipeline', () => {
  const workIds: string[] = [];
  const partIds: string[] = [];
  const assetIds: string[] = [];
  let memory = createMemoryObjectStore();
  let tempDir = '';

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'legacy-audio-pipeline-'));
    process.env.ALLOW_LEGACY_AUDIO_METADATA_MIGRATION = '1';
    process.env.ALLOW_LEGACY_AUDIO_SEGMENT_CLEANUP = '1';
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    memory = createMemoryObjectStore();
    setObjectStoreForTests(memory);
  });

  afterEach(async () => {
    if (assetIds.length > 0) {
      await db.delete(contentAssetTable).where(inArray(contentAssetTable.id, assetIds));
      assetIds.length = 0;
    }
    if (partIds.length > 0) {
      await db.delete(readingPartTable).where(inArray(readingPartTable.id, partIds));
      partIds.length = 0;
    }
    if (workIds.length > 0) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, workIds));
      workIds.length = 0;
    }
  });

  async function insertWork() {
    const workId = `work_${randomUUID()}`;
    await db.insert(readingWorkTable).values({
      id: workId,
      title: 'Legacy audio pipeline',
      author: 'Test',
      language: 'en',
      status: 'published',
      originMeta: {},
    });
    workIds.push(workId);
    return workId;
  }

  async function insertPart(workId: string, partId: string) {
    await db.insert(readingPartTable).values({
      id: partId,
      workId,
      sortOrder: partIds.length,
      kind: 'body',
      title: 'Chapter',
      body: 'Legacy audio body.',
    });
    partIds.push(partId);
  }

  async function insertLegacyAudioAsset(input: {
    workId: string;
    partId: string;
    chapterKey: string;
    segmentKeys: string[];
  }) {
    await insertPart(input.workId, input.partId);
    const assetId = `asset_${randomUUID()}`;
    await db.insert(contentAssetTable).values({
      id: assetId,
      workId: input.workId,
      partId: input.partId,
      kind: 'audio_us',
      storageKey: input.chapterKey,
      mimeType: 'audio/mpeg',
      contentHash: 'legacy_hash',
      status: 'ready',
      meta: {
        objectKeys: [input.chapterKey, ...input.segmentKeys],
        timeline: input.segmentKeys.map((segmentKey, index) => ({
          index,
          textHash: `t${index}`,
          startMs: index * 1000,
          durationMs: 900,
          storageKey: segmentKey,
          wordTimings: [{ text: 'word', audioOffsetMs: 0, durationMs: 100, textOffset: 0 }],
        })),
      },
    });
    assetIds.push(assetId);
    return assetId;
  }

  async function putObject(key: string, size = 32) {
    await memory.put({ key, body: Buffer.alloc(size, 1), contentType: 'audio/mpeg' });
  }

  it('migrates metadata from approved manifest then deletes only approved legacy segments', async () => {
    const workId = await insertWork();
    const partId = `part_${randomUUID()}`;
    const chapterKey = `part-audio/${partId}/audio_us/legacy/chapter.mp3`;
    const seg0 = `part-audio/${partId}/audio_us/legacy/seg/0000.mp3`;
    const seg1 = `part-audio/${partId}/audio_us/legacy/seg/0001.mp3`;
    const assetId = await insertLegacyAudioAsset({ workId, partId, chapterKey, segmentKeys: [seg0, seg1] });

    await putObject(chapterKey, 80);
    await putObject(seg0, 20);
    await putObject(seg1, 20);

    const dryRunManifestPath = path.join(tempDir, `metadata-dry-run-${randomUUID()}.json`);
    const dryRun = await runLegacyMetadataMigration({
      databaseName: 'gloaming_test',
      manifestPath: dryRunManifestPath,
    });
    const ourCandidate = dryRun.manifest.candidates.find((candidate) => candidate.assetId === assetId);
    expect(ourCandidate).toBeTruthy();
    expect(ourCandidate?.removedObjectKeyCount).toBe(2);

    const scopedDryRunPath = path.join(tempDir, `metadata-dry-run-scoped-${randomUUID()}.json`);
    const scopedManifest = {
      ...dryRun.manifest,
      candidates: [ourCandidate!],
      candidateCount: 1,
      fingerprint: '',
      removedObjectKeyCount: ourCandidate!.removedObjectKeyCount,
      removedTimelineKeyCount: ourCandidate!.removedTimelineKeyCount,
    };
    const { computeMetadataMigrationFingerprint } =
      await import('@/modules/asset-management/legacy-metadata-migration-guards');
    scopedManifest.fingerprint = computeMetadataMigrationFingerprint(scopedManifest.candidates);
    await writeFile(scopedDryRunPath, `${JSON.stringify(scopedManifest, null, 2)}\n`);

    const approvedBeforeExecute = JSON.parse(await readFile(scopedDryRunPath, 'utf8'));
    const executeManifestPath = path.join(tempDir, `metadata-execute-${randomUUID()}.json`);
    const execute = await runLegacyMetadataMigration({
      execute: true,
      databaseName: 'gloaming_test',
      manifestPath: scopedDryRunPath,
      outputPath: executeManifestPath,
    });
    expect(execute.manifest.updatedAssetIds).toEqual([assetId]);
    expect(execute.manifest.conflicts).toEqual([]);
    expect(execute.manifestPath).toBe(executeManifestPath);
    expect(execute.manifest.mode).toBe('execute');
    expect(execute.manifest.executedAt).toEqual(expect.any(String));
    const approvedAfterExecute = JSON.parse(await readFile(scopedDryRunPath, 'utf8'));
    expect(approvedAfterExecute.mode).toBe('dry-run');
    expect(approvedAfterExecute.fingerprint).toBe(approvedBeforeExecute.fingerprint);
    expect(approvedAfterExecute.candidates).toEqual(approvedBeforeExecute.candidates);

    const [row] = await db.select().from(contentAssetTable).where(eq(contentAssetTable.id, assetId)).limit(1);
    expect(row?.meta.objectKeys).toEqual([chapterKey]);
    expect(row?.meta.timeline?.every((segment) => !('storageKey' in segment))).toBe(true);
    expect(
      (row?.meta.objectKeys ?? []).filter((key) => key.includes('/seg/')).length +
        (row?.meta.timeline ?? []).filter((segment) => segment.storageKey?.includes('/seg/')).length,
    ).toBe(0);

    setObjectStoreForTests(memory);
    const cleanupDryRunPath = path.join(tempDir, `cleanup-dry-run-${randomUUID()}.json`);
    const cleanupDryRun = await runLegacySegmentCleanup({ manifestPath: cleanupDryRunPath });
    expect(cleanupDryRun.manifest.eligibleKeys.toSorted()).toEqual([seg0, seg1]);
    expect(cleanupDryRun.manifest.scanComplete).toBe(true);

    const cleanupApprovedBefore = JSON.parse(await readFile(cleanupDryRunPath, 'utf8'));
    setObjectStoreForTests(memory);
    const cleanupExecutePath = path.join(tempDir, `cleanup-execute-${randomUUID()}.json`);
    const cleanupExecute = await runLegacySegmentCleanup({
      execute: true,
      approvedManifestPath: cleanupDryRunPath,
      expectedBucket: process.env.S3_BUCKET!,
      outputPath: cleanupExecutePath,
    });
    expect(cleanupExecute.manifestPath).toBe(cleanupExecutePath);
    expect(cleanupExecute.manifest.mode).toBe('execute');
    expect(cleanupExecute.manifest.executedAt).toEqual(expect.any(String));
    expect(cleanupExecute.manifest.deletedKeys.toSorted()).toEqual([seg0, seg1]);
    expect(cleanupExecute.manifest.remainingEligibleCount).toBe(0);
    expect(cleanupExecute.manifest.verification?.passed).toBe(true);
    expect(cleanupExecute.manifest.failed).toEqual([]);
    const cleanupApprovedAfter = JSON.parse(await readFile(cleanupDryRunPath, 'utf8'));
    expect(cleanupApprovedAfter.mode).toBe('dry-run');
    expect(cleanupApprovedAfter.eligibleKeysFingerprint).toBe(cleanupApprovedBefore.eligibleKeysFingerprint);
    expect(cleanupApprovedAfter.eligibleKeys).toEqual(cleanupApprovedBefore.eligibleKeys);
    const cleanupExecuteWritten = JSON.parse(await readFile(cleanupExecutePath, 'utf8'));
    expect(cleanupExecuteWritten.mode).toBe('execute');
    expect(cleanupExecuteWritten.deletedKeys.toSorted()).toEqual([seg0, seg1]);
    expect(cleanupExecuteWritten.skipped).toEqual(expect.any(Array));
    expect(cleanupExecuteWritten.failed).toEqual([]);
    expect(cleanupExecuteWritten.verification?.passed).toBe(true);
    expect(cleanupExecuteWritten.executedAt).toEqual(expect.any(String));
    expect(cleanupExecuteWritten.remainingEligibleCount).toBe(0);
    expect(memory.store.has(seg0)).toBe(false);
    expect(memory.store.has(seg1)).toBe(false);
    expect(memory.store.has(chapterKey)).toBe(true);

    const assetResponse = await app.request(`/api/assets/${assetId}`);
    expect(assetResponse.status).toBe(200);
  });

  it('does not expand metadata execute beyond approved dry-run manifest', async () => {
    const workId = await insertWork();
    const partId = `part_${randomUUID()}`;
    const chapterKey = `part-audio/${partId}/audio_us/new/chapter.mp3`;
    const seg = `part-audio/${partId}/audio_us/new/seg/0000.mp3`;
    const assetId = await insertLegacyAudioAsset({ workId, partId, chapterKey, segmentKeys: [seg] });
    await putObject(chapterKey);
    await putObject(seg);

    const dryRunPath = path.join(tempDir, `metadata-dry-run-only-${randomUUID()}.json`);
    const dryRun = await runLegacyMetadataMigration({ databaseName: 'gloaming_test', manifestPath: dryRunPath });
    const ourCandidate = dryRun.manifest.candidates.find((candidate) => candidate.assetId === assetId);
    expect(ourCandidate).toBeTruthy();
    const scopedDryRunPath = path.join(tempDir, `metadata-dry-run-scoped-only-${randomUUID()}.json`);
    const { computeMetadataMigrationFingerprint } =
      await import('@/modules/asset-management/legacy-metadata-migration-guards');
    const approved = {
      ...dryRun.manifest,
      candidates: [ourCandidate!],
      candidateCount: 1,
      removedObjectKeyCount: ourCandidate!.removedObjectKeyCount,
      removedTimelineKeyCount: ourCandidate!.removedTimelineKeyCount,
      fingerprint: computeMetadataMigrationFingerprint([ourCandidate!]),
    };
    await writeFile(scopedDryRunPath, `${JSON.stringify(approved, null, 2)}\n`);

    const newPartId = `part_${randomUUID()}`;
    const newChapter = `part-audio/${newPartId}/audio_us/extra/chapter.mp3`;
    const newSeg = `part-audio/${newPartId}/audio_us/extra/seg/0000.mp3`;
    await insertLegacyAudioAsset({
      workId,
      partId: newPartId,
      chapterKey: newChapter,
      segmentKeys: [newSeg],
    });
    await putObject(newChapter);
    await putObject(newSeg);

    const execute = await runLegacyMetadataMigration({
      execute: true,
      databaseName: 'gloaming_test',
      manifestPath: scopedDryRunPath,
      outputPath: path.join(tempDir, `metadata-execute-only-${randomUUID()}.json`),
    });
    expect(execute.manifest.updatedAssetIds).toEqual([assetId]);
    expect(execute.manifest.updatedAssetIds).not.toContain(expect.stringMatching(/extra/));

    const [extraRow] = await db
      .select()
      .from(contentAssetTable)
      .where(eq(contentAssetTable.storageKey, newChapter))
      .limit(1);
    expect(extraRow?.meta.objectKeys).toContain(newSeg);
  });

  it('keeps non-legacy timeline storageKey out of migration candidates', () => {
    const customKey = 'part-audio/p1/audio_us/h/custom.mp3';
    const migrated = computeMigratedAudioMetadata({
      storageKey: 'part-audio/p1/audio_us/h/chapter.mp3',
      meta: {
        objectKeys: ['part-audio/p1/audio_us/h/chapter.mp3', 'part-audio/p1/audio_us/h/seg/0000.mp3'],
        timeline: [
          {
            index: 0,
            textHash: 't0',
            startMs: 0,
            durationMs: 1000,
            storageKey: customKey,
            wordTimings: [],
          },
        ],
      },
    });
    expect(migrated.timeline?.[0]).toHaveProperty('storageKey', customKey);
  });
});
