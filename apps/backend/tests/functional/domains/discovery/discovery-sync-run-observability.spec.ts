import { randomUUID } from 'node:crypto';

import { and, count, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverySource as discoverySourceTable, sourceRecord as sourceRecordTable } from '@gloaming/db/schema';
import { discoverySyncRun as discoverySyncRunTable } from '@gloaming/db/schema';
import {
  DISCOVERY_SYNC_RUN_HISTORY_LIMIT,
  discoverySyncRunHistorySchema,
  discoverySyncRunSummarySchema,
} from '@gloaming/shared/discovery';

import type * as DiscoveryCategories from '@/domains/discovery/categories';
import { PROJECT_GUTENBERG_SOURCE_TYPE } from '@/domains/discovery/gutenberg/constants';
import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import type * as SyncRepository from '@/domains/discovery/sync/repository';
import {
  claimSourceQueued,
  createDiscoverySyncRun,
  ensureDiscoverySource,
  recoverStaleDiscoverySyncRun,
} from '@/domains/discovery/sync/repository';
import { syncProjectGutenbergMetadata } from '@/domains/discovery/sync/service';
import { db } from '@/infra/db';

const snapshotMocks = vi.hoisted(() => ({ open: vi.fn() }));

/**
 * The sync service resolves its source by the stable project_gutenberg key, so
 * this run redirects that key to a run-owned fixture source and deletes only it
 * afterwards (same pattern as discovery-sync-service.spec.ts): the test never
 * writes the stable global source row or fabricates run history on it.
 */
const fixtureSourceKey = vi.hoisted(() => `sync_run_obs_${crypto.randomUUID()}`);

vi.mock('@/domains/discovery/sync/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof SyncRepository>();
  const { PROJECT_GUTENBERG_SOURCE_KEY } = await import('@/domains/discovery/gutenberg/constants');
  return {
    ...actual,
    ensureDiscoverySource: (sourceKey: string, sourceType: string) =>
      actual.ensureDiscoverySource(
        sourceKey === PROJECT_GUTENBERG_SOURCE_KEY ? fixtureSourceKey : sourceKey,
        sourceType,
      ),
  };
});

vi.mock('@/domains/discovery/gutenberg/snapshot-stream', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, openGutenbergSnapshot: snapshotMocks.open };
});

/** Partial-failure control: fail the classification write after the first committed batch. */
const failureGate = vi.hoisted(() => ({
  failAfterBatches: Number.POSITIVE_INFINITY,
  batches: 0,
  reset() {
    this.failAfterBatches = Number.POSITIVE_INFINITY;
    this.batches = 0;
  },
}));

vi.mock('@/domains/discovery/categories', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof DiscoveryCategories;
  return {
    ...actual,
    recordPublicClassificationEvidenceBatch: async (
      ...args: Parameters<typeof actual.recordPublicClassificationEvidenceBatch>
    ) => {
      const result = await actual.recordPublicClassificationEvidenceBatch(...args);
      failureGate.batches += 1;
      if (failureGate.batches >= failureGate.failAfterBatches) {
        throw new Error('Injected failure after committed batch');
      }
      return result;
    },
  };
});

const runId = randomUUID();
let sourceId = '';

function fixtureRecord(index: number): ParsedSourceRecord {
  return {
    externalId: `${runId}-${index}`,
    title: `Run observability fixture ${index}`,
    authors: [{ name: `Author ${index}` }],
    languages: ['en'],
    description: null,
    rightsStatement: null,
    coverUrl: null,
    contentCandidates: [],
    sourceMeta: {},
    sourceUpdatedAt: null,
  };
}

function records(count: number): ParsedSourceRecord[] {
  return Array.from({ length: count }, (_, index) => fixtureRecord(index));
}

function fakeSnapshot(list: ParsedSourceRecord[], lastModified = 'Tue, 01 Jan 2030 00:00:00 GMT') {
  return {
    lastModified,
    records: (async function* () {
      for (const record of list) {
        yield record;
      }
    })(),
    close: vi.fn(),
  };
}

async function claimQueued(): Promise<Date> {
  const claimedAt = await claimSourceQueued(sourceId);
  expect(claimedAt).not.toBeNull();
  return claimedAt!;
}

async function runRowFor(claimToken: Date) {
  const [row] = await db
    .select()
    .from(discoverySyncRunTable)
    .where(and(eq(discoverySyncRunTable.sourceId, sourceId), eq(discoverySyncRunTable.claimToken, claimToken)))
    .limit(1);
  return row ?? null;
}

async function resetSource(): Promise<void> {
  await db
    .update(discoverySourceTable)
    .set({
      enabled: true,
      syncStatus: 'idle',
      syncStartedAt: null,
      syncFinishedAt: null,
      lastErrorSummary: null,
      snapshotLastModified: null,
    })
    .where(eq(discoverySourceTable.id, sourceId));
}

describe('Discovery sync run observability on gloaming_test', () => {
  beforeAll(async () => {
    const source = await ensureDiscoverySource(fixtureSourceKey, PROJECT_GUTENBERG_SOURCE_TYPE);
    sourceId = source.id;
  });

  beforeEach(async () => {
    failureGate.reset();
    snapshotMocks.open.mockReset();
    await db
      .delete(sourceRecordTable)
      .where(and(eq(sourceRecordTable.sourceId, sourceId), like(sourceRecordTable.externalId, `${runId}-%`)));
    await db.delete(discoverySyncRunTable).where(eq(discoverySyncRunTable.sourceId, sourceId));
    await resetSource();
  });

  afterAll(async () => {
    await db
      .delete(sourceRecordTable)
      .where(and(eq(sourceRecordTable.sourceId, sourceId), like(sourceRecordTable.externalId, `${runId}-%`)));
    await db.delete(discoverySyncRunTable).where(eq(discoverySyncRunTable.sourceId, sourceId));
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
  });

  it('creates a durable queued run at claim time, idempotent per claim token', async () => {
    const claimedAt = await claimQueued();
    const created = await createDiscoverySyncRun({ sourceId, claimToken: claimedAt, now: new Date() });
    const repeated = await createDiscoverySyncRun({ sourceId, claimToken: claimedAt, now: new Date() });
    expect(repeated.id).toBe(created.id);
    const row = await runRowFor(claimedAt);
    expect(row).toMatchObject({ stage: 'queued', committedRecords: 0, committedBatches: 0, startedAt: null });
    expect(row?.finishedAt).toBeNull();
  });

  it('records committed progress and a truthful terminal summary for a successful run', async () => {
    snapshotMocks.open.mockResolvedValue(fakeSnapshot(records(3)));
    const claimedAt = await claimQueued();
    const result = await syncProjectGutenbergMetadata({ claimedAt });
    expect(result).toMatchObject({ status: 'succeeded', seenRecords: 3, batches: 1, committedRecords: 3 });

    const row = await runRowFor(claimedAt);
    expect(row).toMatchObject({
      stage: 'succeeded',
      committedRecords: 3,
      committedBatches: 1,
      unavailableRecords: 0,
      errorSummary: null,
      snapshotLastModified: 'Tue, 01 Jan 2030 00:00:00 GMT',
    });
    expect(row?.startedAt).not.toBeNull();
    expect(row?.finishedAt).not.toBeNull();
    // Progress activity must reflect the actual batch commit, not a fake heartbeat.
    expect(row!.lastActivityAt.getTime()).toBeGreaterThanOrEqual(row!.startedAt!.getTime());
  });

  it('keeps earlier committed batches visible as partial progress on a failed run', async () => {
    // Real batch size is 500; 502 records flush a full first batch (500) and a
    // partial second batch (2) that the injected failure rolls back.
    snapshotMocks.open.mockImplementation(async () => fakeSnapshot(records(502)));
    failureGate.failAfterBatches = 2;
    const claimedAt = await claimQueued();
    const result = await syncProjectGutenbergMetadata({ claimedAt });
    expect(result.status).toBe('failed');

    const row = await runRowFor(claimedAt);
    expect(row).toMatchObject({
      stage: 'failed',
      committedRecords: 500,
      committedBatches: 1,
      errorSummary: 'the Project Gutenberg metadata sync failed with Error',
    });
    expect(row?.finishedAt).not.toBeNull();
  });

  it('records a 304 as a distinct not-modified terminal run', async () => {
    await db
      .update(discoverySourceTable)
      .set({ snapshotLastModified: 'Wed, 02 Jan 2030 00:00:00 GMT' })
      .where(eq(discoverySourceTable.id, sourceId));
    snapshotMocks.open.mockResolvedValue(null);
    const claimedAt = await claimQueued();
    const result = await syncProjectGutenbergMetadata({ claimedAt });
    expect(result).toMatchObject({ status: 'not-modified' });

    const row = await runRowFor(claimedAt);
    expect(row).toMatchObject({
      stage: 'not_modified',
      committedRecords: 0,
      committedBatches: 0,
      errorSummary: null,
      snapshotLastModified: 'Wed, 02 Jan 2030 00:00:00 GMT',
    });
  });

  it('does not fabricate or alter any run when a superseded claim is delivered', async () => {
    const claimedAt = await claimQueued();
    // A newer generation claims the source, so this executor no longer owns it.
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'queued', syncStartedAt: new Date() })
      .where(eq(discoverySourceTable.id, sourceId));
    const before = await db.select().from(discoverySyncRunTable).where(eq(discoverySyncRunTable.sourceId, sourceId));

    const result = await syncProjectGutenbergMetadata({ claimedAt });
    expect(result.status).toBe('skipped-not-queued');

    // The stale job neither fabricates a new run nor rewrites any existing one.
    const after = await db.select().from(discoverySyncRunTable).where(eq(discoverySyncRunTable.sourceId, sourceId));
    expect(after).toEqual(before);
  });

  it('refuses progress updates from a stale executor whose run was replaced', async () => {
    let releaseGate!: () => void;
    let batchReached!: () => void;
    const batchReachedPromise = new Promise<void>((resolve) => {
      batchReached = resolve;
    });
    const gatePromise = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    // Slow down the first evidence lookup so the run can be replaced mid-batch.
    const repository = await import('@/domains/discovery/sync/repository');
    const original = repository.loadClassificationEvidenceByExternalId;
    const spy = vi
      .spyOn(repository, 'loadClassificationEvidenceByExternalId')
      .mockImplementation(async (...args: Parameters<typeof original>) => {
        const result = await original(...args);
        batchReached();
        await gatePromise;
        return result;
      });

    try {
      snapshotMocks.open.mockResolvedValue(fakeSnapshot([fixtureRecord(0)]));
      const claimedAt = await claimQueued();
      const runPromise = syncProjectGutenbergMetadata({ claimedAt });
      await batchReachedPromise;

      // Recover the run and let a new generation claim the source.
      const now = new Date();
      await db
        .update(discoverySourceTable)
        .set({ syncStatus: 'failed', syncFinishedAt: now, lastErrorSummary: 'recovered stale run' })
        .where(eq(discoverySourceTable.id, sourceId));
      const newClaim = await claimSourceQueued(sourceId);
      expect(newClaim).not.toBeNull();
      await createDiscoverySyncRun({ sourceId, claimToken: newClaim!, now: new Date() });
      // Simulate the new run starting and recording progress.
      await db
        .update(discoverySyncRunTable)
        .set({ stage: 'processing', startToken: newClaim, committedRecords: 11, committedBatches: 1 })
        .where(and(eq(discoverySyncRunTable.sourceId, sourceId), eq(discoverySyncRunTable.claimToken, newClaim!)));

      releaseGate();
      const result = await runPromise;
      expect(result.status).toBe('skipped-not-queued');

      // The stale run must not have advanced its own or the new run's counters.
      const staleRow = await runRowFor(claimedAt);
      expect(staleRow).toMatchObject({ committedRecords: 0, committedBatches: 0 });
      const newRow = await runRowFor(newClaim!);
      expect(newRow).toMatchObject({ committedRecords: 11, committedBatches: 1, stage: 'processing' });
    } finally {
      spy.mockRestore();
    }
  });

  it('synchronizes run history with a syncing timeout recovery matched by start token', async () => {
    const claimedAt = await claimQueued();
    await createDiscoverySyncRun({ sourceId, claimToken: claimedAt, now: new Date() });
    // Simulate a run that started (distinct start token) and then died without
    // a terminal write; recovery presents the start token, not the claim token.
    const startToken = new Date(claimedAt.getTime() + 1);
    await db
      .update(discoverySyncRunTable)
      .set({
        stage: 'processing',
        startToken,
        startedAt: startToken,
        committedRecords: 2,
        committedBatches: 1,
      })
      .where(and(eq(discoverySyncRunTable.sourceId, sourceId), eq(discoverySyncRunTable.claimToken, claimedAt)));
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'syncing', syncStartedAt: startToken })
      .where(eq(discoverySourceTable.id, sourceId));

    await recoverStaleDiscoverySyncRun({
      sourceId,
      claimToken: startToken,
      errorSummary: 'the Project Gutenberg metadata sync exceeded its time limit',
      finishedAt: new Date(),
    });

    const row = await runRowFor(claimedAt);
    expect(row).toMatchObject({
      stage: 'failed',
      committedRecords: 2,
      committedBatches: 1,
      errorSummary: 'the Project Gutenberg metadata sync exceeded its time limit',
    });
    expect(row?.finishedAt).not.toBeNull();
  });

  it('closes a queued timeout recovery matched by claim token', async () => {
    const claimedAt = await claimQueued();
    // The claim was made but the run never started; recovery presents the claim
    // token and must close the still-queued run row.
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'queued', syncStartedAt: claimedAt })
      .where(eq(discoverySourceTable.id, sourceId));

    await recoverStaleDiscoverySyncRun({
      sourceId,
      claimToken: claimedAt,
      errorSummary: 'the Project Gutenberg metadata sync was never started',
      finishedAt: new Date(),
    });

    const row = await runRowFor(claimedAt);
    expect(row).toMatchObject({
      stage: 'failed',
      errorSummary: 'the Project Gutenberg metadata sync was never started',
    });
    expect(row?.finishedAt).not.toBeNull();
  });

  it('leaves a pre-migration untracked source recoverable without fabricating a run', async () => {
    // A source goes stale with no run row (created before run tracking existed).
    const ghostToken = new Date(Date.now() - 60_000);
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'syncing', syncStartedAt: ghostToken })
      .where(eq(discoverySourceTable.id, sourceId));

    // Must not throw and must not fabricate history for the untracked token.
    await recoverStaleDiscoverySyncRun({
      sourceId,
      claimToken: ghostToken,
      errorSummary: 'the Project Gutenberg metadata sync exceeded its time limit',
      finishedAt: new Date(),
    });

    expect(await runRowFor(ghostToken)).toBeNull();
  });

  it('keeps the bounded history contract and never fabricates runs for untracked claims', async () => {
    const claimedAt = await claimQueued();
    await syncProjectGutenbergMetadata({ claimedAt });

    const runs = await db.select().from(discoverySyncRunTable).where(eq(discoverySyncRunTable.sourceId, sourceId));
    expect(runs).toHaveLength(1);
    expect(runs.length).toBeLessThanOrEqual(DISCOVERY_SYNC_RUN_HISTORY_LIMIT);

    const parsed = discoverySyncRunHistorySchema.safeParse({ runs: runs.map(toSummaryLike) });
    expect(parsed.success).toBe(true);
    expect(discoverySyncRunSummarySchema.safeParse(toSummaryLike(runs[0]!)).success).toBe(true);

    // A claim without a tracked run yields no fabricated history row.
    expect(await runRowFor(new Date(Date.now() + 123_456))).toBeNull();
  });

  it('exposes only committed current-run metrics (no totals or percentage fields)', async () => {
    snapshotMocks.open.mockResolvedValue(fakeSnapshot(records(2)));
    const claimedAt = await claimQueued();
    await syncProjectGutenbergMetadata({ claimedAt });
    const row = (await runRowFor(claimedAt))!;
    const summary = discoverySyncRunSummarySchema.parse(toSummaryLike(row));
    expect(summary).not.toHaveProperty('totalRecords');
    expect(summary).not.toHaveProperty('percent');
    expect(summary.committedRecords).toBe(2);
    // The source-level total stays on the source row, distinct from run counts.
    const [total] = await db
      .select({ value: count() })
      .from(sourceRecordTable)
      .where(eq(sourceRecordTable.sourceId, sourceId));
    expect(Number(total?.value ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it('does not fabricate or alter any run when the executor no longer owns the source row', async () => {
    snapshotMocks.open.mockResolvedValue(fakeSnapshot([fixtureRecord(0)]));
    const claimedAt = await claimQueued();
    // Ownership is lost right after the source row start transition would have
    // happened: run the sync against a source that was already recovered.
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'failed', syncStartedAt: null, lastErrorSummary: 'recovered' })
      .where(eq(discoverySourceTable.id, sourceId));
    const before = await db.select().from(discoverySyncRunTable).where(eq(discoverySyncRunTable.sourceId, sourceId));

    const result = await syncProjectGutenbergMetadata({ claimedAt });
    expect(result.status).toBe('skipped-not-queued');

    // The stale job neither fabricates a new run nor records a failure for one.
    const after = await db.select().from(discoverySyncRunTable).where(eq(discoverySyncRunTable.sourceId, sourceId));
    expect(after).toEqual(before);
  });
});

function toSummaryLike(row: typeof discoverySyncRunTable.$inferSelect) {
  return {
    id: row.id,
    stage: row.stage,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    lastActivityAt: row.lastActivityAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    committedRecords: row.committedRecords,
    committedBatches: row.committedBatches,
    unavailableRecords: row.unavailableRecords,
    errorSummary: row.errorSummary,
  };
}
