import { randomUUID } from 'node:crypto';

import { UnrecoverableError } from 'bullmq';
import { and, count, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  userLibraryItem as userLibraryItemTable,
} from '@gloaming/db';
import {
  discoverySource as discoverySourceTable,
  discoverySyncRun as discoverySyncRunTable,
  sourceRecord as sourceRecordTable,
  sourceRecordPublicClassificationState as stateTable,
} from '@gloaming/db/schema';

import { JOB_DISCOVERY_SYNC, processDiscoverySync } from '@/application/jobs/discovery-sync';
import type * as DiscoveryCategories from '@/domains/discovery/categories';
import { loadDuePublicClassifications } from '@/domains/discovery/categories/incremental-classification-repository';
import {
  PROJECT_GUTENBERG_RDF_SNAPSHOT_URL,
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SOURCE_TYPE,
  PROJECT_GUTENBERG_UPSERT_BATCH_SIZE,
} from '@/domains/discovery/gutenberg/constants';
import { GutenbergSnapshotError } from '@/domains/discovery/gutenberg/errors';
import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import type * as GutenbergSnapshotStream from '@/domains/discovery/gutenberg/snapshot-stream';
import type * as SyncRepository from '@/domains/discovery/sync/repository';
import {
  claimSourceQueued,
  ensureDiscoverySource,
  markSourceFailed,
  markSourceSucceeded,
  upsertSourceRecords,
} from '@/domains/discovery/sync/repository';
import { syncProjectGutenbergMetadata } from '@/domains/discovery/sync/service';
import { db } from '@/infra/db';
import { processJob } from '@/worker';

const snapshotMocks = vi.hoisted(() => ({ open: vi.fn() }));
const fixtureSourceKey = vi.hoisted(() => `sync_recovery_${crypto.randomUUID()}`);

vi.mock('@/domains/discovery/gutenberg/snapshot-stream', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, openGutenbergSnapshot: snapshotMocks.open };
});

/**
 * Controllable gate + write counters for the flushBatch abort regression.
 * The repository/categories modules are only wrapped (partial mock): every
 * call runs the real implementation unless a test explicitly injects a failure.
 * Source lookup uses a run-owned source so reconciliation never touches existing data.
 */
const flushGate = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  onEvidenceReached: null as null | (() => void),
  evidenceCalls: 0,
  upsertCalls: 0,
  reconcileCalls: 0,
  succeededCalls: 0,
  classificationCalls: 0,
  failClassification: false,
  failAfterClassificationWrite: false,
  lastClassificationId: '',
  reconcileGate: null as Promise<void> | null,
  onReconcileReached: null as null | (() => void),
  reset() {
    this.gate = null;
    this.onEvidenceReached = null;
    this.evidenceCalls = 0;
    this.upsertCalls = 0;
    this.reconcileCalls = 0;
    this.succeededCalls = 0;
    this.classificationCalls = 0;
    this.failClassification = false;
    this.failAfterClassificationWrite = false;
    this.lastClassificationId = '';
    this.reconcileGate = null;
    this.onReconcileReached = null;
  },
}));

vi.mock('@/domains/discovery/sync/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof SyncRepository>();
  return {
    ...actual,
    ensureDiscoverySource: (_sourceKey: string, sourceType: string) =>
      actual.ensureDiscoverySource(fixtureSourceKey, sourceType),
    loadClassificationEvidenceByExternalId: async (
      ...args: Parameters<typeof actual.loadClassificationEvidenceByExternalId>
    ) => {
      flushGate.evidenceCalls += 1;
      const gate = flushGate.gate;
      const reached = flushGate.onEvidenceReached;
      flushGate.gate = null;
      flushGate.onEvidenceReached = null;
      reached?.();
      if (gate) await gate;
      return actual.loadClassificationEvidenceByExternalId(...args);
    },
    upsertSourceRecords: (...args: Parameters<typeof actual.upsertSourceRecords>) => {
      flushGate.upsertCalls += 1;
      return actual.upsertSourceRecords(...args);
    },
    reconcileUnavailableRecords: async (...args: Parameters<typeof actual.reconcileUnavailableRecords>) => {
      flushGate.reconcileCalls += 1;
      const gate = flushGate.reconcileGate;
      const reached = flushGate.onReconcileReached;
      flushGate.reconcileGate = null;
      flushGate.onReconcileReached = null;
      reached?.();
      if (gate) await gate;
      return actual.reconcileUnavailableRecords(...args);
    },
    markSourceSucceeded: (...args: Parameters<typeof actual.markSourceSucceeded>) => {
      flushGate.succeededCalls += 1;
      return actual.markSourceSucceeded(...args);
    },
  };
});

vi.mock('@/domains/discovery/categories', async (importOriginal) => {
  const actual = await importOriginal<typeof DiscoveryCategories>();
  return {
    ...actual,
    recordPublicClassificationEvidenceBatch: async (
      ...args: Parameters<typeof actual.recordPublicClassificationEvidenceBatch>
    ) => {
      flushGate.classificationCalls += 1;
      flushGate.lastClassificationId = args[0][0]?.sourceRecordId ?? '';
      if (flushGate.failClassification) throw new Error('Injected classification evidence write failure');
      const result = await actual.recordPublicClassificationEvidenceBatch(...args);
      if (flushGate.failAfterClassificationWrite) throw new Error('Injected failure after classification write');
      return result;
    },
  };
});

const runId = randomUUID();
const TIMEOUT_SUMMARY = 'the Project Gutenberg metadata sync exceeded its time limit';
/** Stored upstream Last-Modified used to distinguish conditional requests. */
const STORED_LAST_MODIFIED = 'Tue, 01 Jan 2030 00:00:00 GMT';
let sourceId = '';

function fixtureRecord(index: number, overrides: Partial<ParsedSourceRecord> = {}): ParsedSourceRecord {
  return {
    externalId: `${runId}-${index}`,
    title: `Sync fixture ${index}`,
    authors: [{ name: `Sync Author ${index}`, role: 'author' }],
    languages: ['en'],
    description: null,
    rightsStatement: null,
    coverUrl: null,
    contentCandidates: [{ format: 'epub', url: `https://example.test/${runId}/${index}.epub` }],
    sourceMeta: {},
    sourceUpdatedAt: null,
    ...overrides,
  };
}

function fakeSnapshot(records: ParsedSourceRecord[], lastModified = 'Tue, 01 Jan 2030 00:00:00 GMT') {
  return {
    lastModified,
    records: (async function* () {
      for (const record of records) {
        yield record;
      }
    })(),
    close: vi.fn(),
  };
}

function failingSnapshot(error: Error) {
  return {
    lastModified: null,
    records: (async function* () {
      yield fixtureRecord(0);
      throw error;
    })(),
    close: vi.fn(),
  };
}

function records(count: number): ParsedSourceRecord[] {
  return Array.from({ length: count }, (_, index) => fixtureRecord(index));
}

/** Claims the source and returns its non-null claim generation token. */
async function claimQueued(): Promise<Date> {
  const claimedAt = await claimSourceQueued(sourceId);
  expect(claimedAt).not.toBeNull();
  return claimedAt!;
}

async function ownedRecordCount(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(sourceRecordTable)
    .where(and(eq(sourceRecordTable.sourceId, sourceId), like(sourceRecordTable.externalId, `${runId}-%`)));
  return Number(row?.value ?? 0);
}

async function availableOwnedRecordCount(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(sourceRecordTable)
    .where(
      and(
        eq(sourceRecordTable.sourceId, sourceId),
        eq(sourceRecordTable.availability, 'available'),
        like(sourceRecordTable.externalId, `${runId}-%`),
      ),
    );
  return Number(row?.value ?? 0);
}

async function sourceRow() {
  const [row] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId)).limit(1);
  return row;
}

async function forbiddenRowCounts(): Promise<Record<string, number>> {
  const [works, parts, assets, state, library] = await Promise.all([
    db.select({ value: count() }).from(readingWorkTable),
    db.select({ value: count() }).from(readingPartTable),
    db.select({ value: count() }).from(contentAssetTable),
    db.select({ value: count() }).from(readingStateTable),
    db.select({ value: count() }).from(userLibraryItemTable),
  ]);
  return {
    readingWork: Number(works[0]?.value ?? 0),
    readingPart: Number(parts[0]?.value ?? 0),
    contentAsset: Number(assets[0]?.value ?? 0),
    readingState: Number(state[0]?.value ?? 0),
    userLibraryItem: Number(library[0]?.value ?? 0),
  };
}

async function resetSourceItself(): Promise<void> {
  await db
    .update(discoverySourceTable)
    .set({
      enabled: true,
      syncStatus: 'idle',
      syncStartedAt: null,
      syncFinishedAt: null,
      lastSuccessAt: null,
      lastErrorSummary: null,
      snapshotLastModified: null,
    })
    .where(eq(discoverySourceTable.id, sourceId));
}

describe('Project Gutenberg sync service on gloaming_test', () => {
  beforeAll(async () => {
    const source = await ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
    sourceId = source.id;
  });

  beforeEach(async () => {
    flushGate.reset();
    snapshotMocks.open.mockReset();
    await db
      .delete(sourceRecordTable)
      .where(and(eq(sourceRecordTable.sourceId, sourceId), like(sourceRecordTable.externalId, `${runId}-%`)));
    await resetSourceItself();
  });

  afterAll(async () => {
    await db
      .delete(sourceRecordTable)
      .where(and(eq(sourceRecordTable.sourceId, sourceId), like(sourceRecordTable.externalId, `${runId}-%`)));
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
  });

  it('upserts a 501-record snapshot in bounded batches without public Gutenberg access', async () => {
    const before = await forbiddenRowCounts();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    snapshotMocks.open.mockResolvedValue(fakeSnapshot(records(501)));

    const claimedAt = await claimQueued();
    const result = await syncProjectGutenbergMetadata({ claimedAt });

    expect(result).toEqual({
      status: 'succeeded',
      lastModified: 'Tue, 01 Jan 2030 00:00:00 GMT',
      seenRecords: 501,
      unavailableRecords: 0,
      batches: 2,
      committedRecords: 501,
    });
    expect(snapshotMocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ url: PROJECT_GUTENBERG_RDF_SNAPSHOT_URL, ifModifiedSince: null }),
    );
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('gutenberg.org'))).toHaveLength(0);
    fetchSpy.mockRestore();

    expect(await ownedRecordCount()).toBe(501);
    expect(await availableOwnedRecordCount()).toBe(501);

    const source = await sourceRow();
    expect(source).toMatchObject({
      syncStatus: 'succeeded',
      lastErrorSummary: null,
      snapshotLastModified: 'Tue, 01 Jan 2030 00:00:00 GMT',
    });
    expect(source?.lastSuccessAt).not.toBeNull();
    expect(await forbiddenRowCounts()).toEqual(before);
  });

  it('is idempotent across repeated identical syncs', async () => {
    snapshotMocks.open.mockImplementation(async () => fakeSnapshot(records(20)));

    const firstClaim = await claimQueued();
    const first = await syncProjectGutenbergMetadata({ claimedAt: firstClaim });
    expect(first).toMatchObject({ status: 'succeeded', seenRecords: 20, batches: 1 });

    await resetSourceItself();
    const secondClaim = await claimQueued();
    const second = await syncProjectGutenbergMetadata({ claimedAt: secondClaim });
    expect(second).toMatchObject({ status: 'succeeded', seenRecords: 20, batches: 1 });

    expect(await ownedRecordCount()).toBe(20);
  });

  it.each(['new', 'changed-legacy', 'changed-completed'] as const)(
    'keeps %s evidence due after a failed registration and identical snapshot retry',
    async (scenario) => {
      const incoming = fixtureRecord(0, { title: 'Changed evidence' });
      let originalId: string | undefined;
      if (scenario !== 'new') {
        [{ id: originalId }] = await upsertSourceRecords(sourceId, [fixtureRecord(0)], new Date());
        if (scenario === 'changed-completed') {
          // An unchanged legacy sync establishes a completed baseline first.
          snapshotMocks.open.mockResolvedValueOnce(fakeSnapshot([fixtureRecord(0)]));
          expect((await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() })).status).toBe('succeeded');
        }
      }

      snapshotMocks.open.mockImplementation(async () => fakeSnapshot([incoming]));
      flushGate.failClassification = true;
      const first = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
      const [afterFailure] = await db.select().from(sourceRecordTable).where(eq(sourceRecordTable.sourceId, sourceId));
      const sourceAfterFailure = await sourceRow();

      flushGate.failClassification = false;
      const retry = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
      expect(retry.status).toBe('succeeded');
      const [record] = await db.select().from(sourceRecordTable).where(eq(sourceRecordTable.sourceId, sourceId));
      const [state] = await db.select().from(stateTable).where(eq(stateTable.sourceRecordId, record!.id));
      expect(state?.completedFingerprint).toBeNull();
      expect(await loadDuePublicClassifications(new Date(), 10_000)).toContainEqual({
        sourceRecordId: record!.id,
        fingerprint: state!.evidenceFingerprint,
      });
      expect(first.status).toBe('failed');
      expect(sourceAfterFailure?.snapshotLastModified).toBe(
        scenario === 'changed-completed' ? 'Tue, 01 Jan 2030 00:00:00 GMT' : null,
      );
      if (scenario === 'new') expect(afterFailure).toBeUndefined();
      else {
        expect(afterFailure).toMatchObject({ id: originalId, title: fixtureRecord(0).title });
        expect(record!.id).toBe(originalId);
      }
    },
  );

  it('baselines unchanged legacy metadata without making it due', async () => {
    const [{ id }] = await upsertSourceRecords(sourceId, [fixtureRecord(0)], new Date());
    snapshotMocks.open.mockResolvedValue(fakeSnapshot([fixtureRecord(0)]));
    expect((await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() })).status).toBe('succeeded');
    const [state] = await db.select().from(stateTable).where(eq(stateTable.sourceRecordId, id!));
    expect(state?.completedFingerprint).toBe(state?.evidenceFingerprint);
    expect(await loadDuePublicClassifications(new Date(), 10_000)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceRecordId: id })]),
    );
  });

  it('rolls back metadata and classification state together after a classification write', async () => {
    snapshotMocks.open.mockImplementation(async () => fakeSnapshot([fixtureRecord(0)]));
    flushGate.failAfterClassificationWrite = true;
    expect((await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() })).status).toBe('failed');
    expect(await ownedRecordCount()).toBe(0);
    expect(
      await db.select().from(stateTable).where(eq(stateTable.sourceRecordId, flushGate.lastClassificationId)),
    ).toHaveLength(0);
    expect((await sourceRow())?.snapshotLastModified).toBeNull();

    flushGate.failAfterClassificationWrite = false;
    expect((await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() })).status).toBe('succeeded');
    const [state] = await db
      .select()
      .from(stateTable)
      .where(eq(stateTable.sourceRecordId, flushGate.lastClassificationId));
    expect(state?.completedFingerprint).toBeNull();
  });

  it('drops a stale run batch that lost its token before the write and keeps the new run state', async () => {
    let releaseGate!: () => void;
    let markReached!: () => void;
    flushGate.gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const evidenceReached = new Promise<void>((resolve) => {
      markReached = resolve;
    });
    flushGate.onEvidenceReached = markReached;

    snapshotMocks.open.mockImplementation(async () => fakeSnapshot([fixtureRecord(0)]));
    const claimedAt = await claimQueued();
    const runPromise = syncProjectGutenbergMetadata({ claimedAt });
    await evidenceReached;

    // The stale run is recovered, then a new generation claims and starts.
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'failed', lastErrorSummary: 'recovered stale run' })
      .where(eq(discoverySourceTable.id, sourceId));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newClaim = await claimSourceQueued(sourceId);
    expect(newClaim).not.toBeNull();
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'syncing', syncStartedAt: newClaim })
      .where(eq(discoverySourceTable.id, sourceId));

    releaseGate();
    const result = await runPromise;

    expect(result).toEqual({ status: 'skipped-not-queued' });
    expect(flushGate.upsertCalls).toBe(0);
    expect(flushGate.classificationCalls).toBe(0);
    expect(flushGate.reconcileCalls).toBe(0);
    expect(flushGate.succeededCalls).toBe(0);
    expect(await ownedRecordCount()).toBe(0);
    const stateRows = await db
      .select({ sourceRecordId: stateTable.sourceRecordId })
      .from(stateTable)
      .innerJoin(sourceRecordTable, eq(sourceRecordTable.id, stateTable.sourceRecordId))
      .where(eq(sourceRecordTable.sourceId, sourceId));
    expect(stateRows).toHaveLength(0);
    const source = await sourceRow();
    expect(source).toMatchObject({ syncStatus: 'syncing', lastErrorSummary: null });
    expect(source?.syncStartedAt?.getTime()).toBe(newClaim!.getTime());
  });

  it('skips reconcile and success after the run token is replaced once the last batch landed', async () => {
    const [{ id: seededId }] = await upsertSourceRecords(sourceId, [fixtureRecord(900)], new Date(Date.now() - 60_000));
    expect(seededId).toBeDefined();

    let releaseGate!: () => void;
    let markReached!: () => void;
    flushGate.reconcileGate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const reconcileReached = new Promise<void>((resolve) => {
      markReached = resolve;
    });
    flushGate.onReconcileReached = markReached;

    snapshotMocks.open.mockImplementation(async () => fakeSnapshot([fixtureRecord(0)]));
    const claimedAt = await claimQueued();
    const runPromise = syncProjectGutenbergMetadata({ claimedAt });
    await reconcileReached;

    // The final batch has committed before the reconcile gate fires.
    expect(await ownedRecordCount()).toBe(2);

    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'failed', lastErrorSummary: 'recovered stale run' })
      .where(eq(discoverySourceTable.id, sourceId));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newClaim = await claimSourceQueued(sourceId);
    expect(newClaim).not.toBeNull();
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'syncing', syncStartedAt: newClaim })
      .where(eq(discoverySourceTable.id, sourceId));

    releaseGate();
    const result = await runPromise;

    expect(result).toEqual({ status: 'skipped-not-queued' });
    expect(flushGate.succeededCalls).toBe(0);
    const [seededRow] = await db.select().from(sourceRecordTable).where(eq(sourceRecordTable.id, seededId!)).limit(1);
    expect(seededRow?.availability).toBe('available');
    const source = await sourceRow();
    expect(source).toMatchObject({ syncStatus: 'syncing' });
    expect(source?.syncStartedAt?.getTime()).toBe(newClaim!.getTime());
  });

  it('reconciles records missing from a later snapshot to unavailable and never deletes them', async () => {
    snapshotMocks.open.mockResolvedValue(fakeSnapshot(records(5)));
    await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });

    await resetSourceItself();
    snapshotMocks.open.mockResolvedValue(fakeSnapshot([fixtureRecord(0), fixtureRecord(1)]));
    const claimedAt = await claimQueued();
    const result = await syncProjectGutenbergMetadata({ claimedAt });

    expect(result).toMatchObject({ status: 'succeeded', seenRecords: 2, unavailableRecords: 3 });
    expect(await ownedRecordCount()).toBe(5);
    expect(await availableOwnedRecordCount()).toBe(2);
  });

  it('skips without fetching when the source is disabled between queueing and execution', async () => {
    const claimedAt = await claimQueued();
    await db.update(discoverySourceTable).set({ enabled: false }).where(eq(discoverySourceTable.id, sourceId));

    const result = await syncProjectGutenbergMetadata({ claimedAt });

    expect(result).toEqual({ status: 'skipped-disabled' });
    expect(snapshotMocks.open).not.toHaveBeenCalled();
    const source = await sourceRow();
    expect(source).toMatchObject({ syncStatus: 'idle', lastErrorSummary: null });
    expect(await ownedRecordCount()).toBe(0);
  });

  it('skips when no queued claim is owned', async () => {
    const result = await syncProjectGutenbergMetadata({ claimedAt: new Date() });
    expect(result).toEqual({ status: 'skipped-not-queued' });
    expect(snapshotMocks.open).not.toHaveBeenCalled();
  });

  it('records a sanitized failure status when the snapshot pipeline fails', async () => {
    snapshotMocks.open.mockResolvedValue(
      failingSnapshot(new GutenbergSnapshotError('an RDF member could not be parsed')),
    );

    const claimedAt = await claimQueued();
    const result = await syncProjectGutenbergMetadata({ claimedAt });

    expect(result).toEqual({ status: 'failed', errorSummary: 'an RDF member could not be parsed' });
    const source = await sourceRow();
    expect(source?.syncStatus).toBe('failed');
    expect(source?.lastErrorSummary).toBe('an RDF member could not be parsed');
  });

  it('fails the run without reconciliation when an ebook member lacks its external identifier', async () => {
    // A previous successful generation whose records reconciliation would flip.
    snapshotMocks.open.mockResolvedValue(fakeSnapshot(records(3)));
    await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
    expect(await availableOwnedRecordCount()).toBe(3);
    flushGate.reset();
    await resetSourceItself();

    // The real parser raises this exact error for a pgterms:ebook member it
    // cannot resolve to an external id; the run must fail before reconciliation.
    const parserError = new GutenbergSnapshotError(
      'an RDF ebook member was missing an external identifier (member: cache/epub/unknown/pgunknown.rdf)',
    );
    snapshotMocks.open.mockResolvedValue(failingSnapshot(parserError));
    const claimedAt = await claimQueued();
    const result = await syncProjectGutenbergMetadata({ claimedAt });

    expect(result).toEqual({ status: 'failed', errorSummary: parserError.message });
    // No reconciliation: the real records from the earlier run stay available.
    expect(flushGate.reconcileCalls).toBe(0);
    expect(await ownedRecordCount()).toBe(3);
    expect(await availableOwnedRecordCount()).toBe(3);
    const source = await sourceRow();
    expect(source?.syncStatus).toBe('failed');
    expect(source?.lastErrorSummary).toContain('missing an external identifier');
    const [runRow] = await db
      .select()
      .from(discoverySyncRunTable)
      .where(and(eq(discoverySyncRunTable.sourceId, sourceId), eq(discoverySyncRunTable.claimToken, claimedAt)))
      .limit(1);
    expect(runRow?.stage).toBe('failed');
    expect(runRow?.errorSummary).toContain('missing an external identifier');
  });

  it('succeeds when non-ebook RDF members are legally skipped and counts them', async () => {
    snapshotMocks.open.mockImplementation((options: { onNonEbookMemberSkipped?: (memberName: string) => void }) => {
      // The real stream reports each legitimately skipped non-ebook member
      // (generator/metadata files) through this hook instead of failing.
      options.onNonEbookMemberSkipped?.('rdf-generator.rdf');
      options.onNonEbookMemberSkipped?.('cache/epub/metadata.rdf');
      return fakeSnapshot(records(2));
    });

    const result = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });

    expect(result).toMatchObject({ status: 'succeeded', seenRecords: 2 });
    expect(snapshotMocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ onNonEbookMemberSkipped: expect.any(Function) }),
    );
    expect(await availableOwnedRecordCount()).toBe(2);
    const source = await sourceRow();
    expect(source?.syncStatus).toBe('succeeded');
  });

  it('requests the snapshot without If-Modified-Since when force is set', async () => {
    const { openGutenbergSnapshot: realOpen } = (await vi.importActual(
      '@/domains/discovery/gutenberg/snapshot-stream',
    )) as typeof GutenbergSnapshotStream;
    snapshotMocks.open.mockImplementation((options: Parameters<typeof realOpen>[0]) => realOpen(options));
    // Answer with 304 so the real stream opener runs its header logic without
    // any public Gutenberg access.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 304 }));
    try {
      await db
        .update(discoverySourceTable)
        .set({ snapshotLastModified: STORED_LAST_MODIFIED })
        .where(eq(discoverySourceTable.id, sourceId));

      const forcedResult = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued(), force: true });
      expect(forcedResult).toMatchObject({ status: 'not-modified' });
      expect(snapshotMocks.open).toHaveBeenLastCalledWith(expect.objectContaining({ ifModifiedSince: null }));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, forcedInit] = fetchSpy.mock.calls[0]!;
      expect(forcedInit?.headers).not.toHaveProperty('If-Modified-Since');

      // Without force the stored date is still revalidated conditionally.
      await resetSourceItself();
      await db
        .update(discoverySourceTable)
        .set({ snapshotLastModified: STORED_LAST_MODIFIED })
        .where(eq(discoverySourceTable.id, sourceId));
      const conditionalResult = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
      expect(conditionalResult).toMatchObject({ status: 'not-modified' });
      expect(snapshotMocks.open).toHaveBeenLastCalledWith(
        expect.objectContaining({ ifModifiedSince: STORED_LAST_MODIFIED }),
      );
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const [, conditionalInit] = fetchSpy.mock.calls[1]!;
      expect(conditionalInit?.headers).toHaveProperty('If-Modified-Since', STORED_LAST_MODIFIED);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('propagates the job-level force flag into the snapshot request', async () => {
    snapshotMocks.open.mockImplementation(async () => fakeSnapshot(records(1)));
    await db
      .update(discoverySourceTable)
      .set({ snapshotLastModified: STORED_LAST_MODIFIED })
      .where(eq(discoverySourceTable.id, sourceId));

    const forcedClaim = await claimQueued();
    await expect(
      processDiscoverySync({
        sourceKey: PROJECT_GUTENBERG_SOURCE_KEY,
        claimedAt: forcedClaim.toISOString(),
        force: true,
      }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(snapshotMocks.open).toHaveBeenLastCalledWith(expect.objectContaining({ ifModifiedSince: null }));

    // A job without `force` keeps the conditional request for the same source.
    await resetSourceItself();
    await db
      .update(discoverySourceTable)
      .set({ snapshotLastModified: STORED_LAST_MODIFIED })
      .where(eq(discoverySourceTable.id, sourceId));
    const plainClaim = await claimQueued();
    await expect(
      processDiscoverySync({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, claimedAt: plainClaim.toISOString() }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(snapshotMocks.open).toHaveBeenLastCalledWith(
      expect.objectContaining({ ifModifiedSince: STORED_LAST_MODIFIED }),
    );
  });

  it('runs through the worker job and surfaces result and error', async () => {
    snapshotMocks.open.mockResolvedValue(fakeSnapshot(records(3)));
    const claimedAt = await claimQueued();

    await expect(
      processJob({
        name: JOB_DISCOVERY_SYNC,
        data: { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, claimedAt: claimedAt.toISOString() },
      }),
    ).resolves.toEqual({ status: 'succeeded' });

    await expect(
      processDiscoverySync({ sourceKey: 'unsupported-source', claimedAt: claimedAt.toISOString() }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    snapshotMocks.open.mockResolvedValue(
      failingSnapshot(new GutenbergSnapshotError('an RDF member could not be parsed')),
    );
    await resetSourceItself();
    const retryClaim = await claimQueued();
    await expect(
      processDiscoverySync({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, claimedAt: retryClaim.toISOString() }),
    ).rejects.toThrow('an RDF member could not be parsed');
  });

  it('keeps existing records available when a later sync fails', async () => {
    snapshotMocks.open.mockResolvedValue(fakeSnapshot(records(3)));
    await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
    expect(await availableOwnedRecordCount()).toBe(3);

    await resetSourceItself();
    snapshotMocks.open.mockResolvedValue(
      failingSnapshot(new GutenbergSnapshotError('an RDF member could not be parsed')),
    );
    const claimedAt = await claimQueued();
    const result = await syncProjectGutenbergMetadata({ claimedAt });

    expect(result.status).toBe('failed');
    expect(await ownedRecordCount()).toBe(3);
    expect(await availableOwnedRecordCount()).toBe(3);
  });

  it('ignores a duplicate job delivery after the queued claim was consumed', async () => {
    snapshotMocks.open.mockImplementation(async () => fakeSnapshot(records(2)));
    const claimedAt = await claimQueued();
    const jobData = { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, claimedAt: claimedAt.toISOString() };

    // A legacy/duplicate job without a valid claim token must not start a run.
    await expect(processDiscoverySync({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, claimedAt: '' })).resolves.toEqual({
      status: 'skipped-not-queued',
    });
    expect(snapshotMocks.open).not.toHaveBeenCalled();

    await expect(processJob({ name: JOB_DISCOVERY_SYNC, data: jobData })).resolves.toEqual({ status: 'succeeded' });
    await expect(processJob({ name: JOB_DISCOVERY_SYNC, data: jobData })).resolves.toEqual({
      status: 'skipped-not-queued',
    });

    expect(snapshotMocks.open).toHaveBeenCalledTimes(1);
    expect(await ownedRecordCount()).toBe(2);
  });

  it('aborts a hung run at the sync time limit and reports a timeout', async () => {
    snapshotMocks.open.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')));
        }),
    );
    const claimedAt = await claimQueued();

    await expect(
      processDiscoverySync(
        { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, claimedAt: claimedAt.toISOString() },
        { timeoutMs: 25 },
      ),
    ).rejects.toThrow(TIMEOUT_SUMMARY);

    const source = await sourceRow();
    expect(source?.syncStatus).toBe('failed');
    expect(source?.lastErrorSummary).toBe(TIMEOUT_SUMMARY);
  });

  it('rejects a late delivery from a previous generation after a re-claim', async () => {
    const claim1 = await claimQueued();
    // Simulate loss: generation 1 is recovered as failed while its job lingers.
    await db.update(discoverySourceTable).set({ syncStatus: 'failed' }).where(eq(discoverySourceTable.id, sourceId));
    // Guarantee a distinct millisecond token for generation 2.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const claim2 = await claimQueued();
    expect(claim2.getTime()).not.toBe(claim1.getTime());

    snapshotMocks.open.mockResolvedValue(fakeSnapshot(records(1)));

    const lateDelivery = await syncProjectGutenbergMetadata({ claimedAt: claim1 });
    expect(lateDelivery).toEqual({ status: 'skipped-not-queued' });
    expect(snapshotMocks.open).not.toHaveBeenCalled();
    const queuedRow = await sourceRow();
    expect(queuedRow).toMatchObject({ syncStatus: 'queued' });
    expect(queuedRow?.syncStartedAt?.getTime()).toBe(claim2.getTime());

    const result = await syncProjectGutenbergMetadata({ claimedAt: claim2 });
    expect(result).toMatchObject({ status: 'succeeded', seenRecords: 1 });
    expect(snapshotMocks.open).toHaveBeenCalledTimes(1);
  });

  it('fences terminal writes from a recovered executor', async () => {
    const t1 = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const t2 = new Date(Date.now() - 60 * 60 * 1000);
    expect(t2.getTime()).not.toBe(t1.getTime());

    // Generation 1 starts, then is lost and recovered as failed.
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'syncing', syncStartedAt: t1 })
      .where(eq(discoverySourceTable.id, sourceId));
    await db.update(discoverySourceTable).set({ syncStatus: 'failed' }).where(eq(discoverySourceTable.id, sourceId));

    // Generation 2 re-claims and starts its own run.
    const claim2 = await claimQueued();
    const claimedRow = await sourceRow();
    expect(claimedRow?.syncStartedAt?.getTime()).toBe(claim2.getTime());
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'syncing', syncStartedAt: t2 })
      .where(eq(discoverySourceTable.id, sourceId));

    // Late terminal writes from generation 1 are fenced no-ops.
    await expect(
      markSourceFailed({
        sourceId,
        errorSummary: 'late failure from generation 1',
        finishedAt: new Date(),
        runStartedAt: t1,
      }),
    ).resolves.toBe(false);
    await expect(
      markSourceSucceeded({ sourceId, lastModified: null, finishedAt: new Date(), runStartedAt: t1 }),
    ).resolves.toBe(false);

    const fencedRow = await sourceRow();
    expect(fencedRow).toMatchObject({ syncStatus: 'syncing', lastErrorSummary: null });
    expect(fencedRow?.syncStartedAt?.getTime()).toBe(t2.getTime());

    // A terminal write fenced by the current run token applies normally.
    await expect(
      markSourceSucceeded({
        sourceId,
        lastModified: 'Tue, 01 Jan 2030 00:00:00 GMT',
        finishedAt: new Date(),
        runStartedAt: t2,
      }),
    ).resolves.toBe(true);
    expect((await sourceRow())?.syncStatus).toBe('succeeded');
  });

  it('stops writing and reconciling after the sync time limit and reports a timeout', async () => {
    const controller = new AbortController();
    // Pre-existing record from an earlier run: post-abort reconciliation would
    // flip it to unavailable, so its availability proves reconcile never ran.
    const preExistingRecord = fixtureRecord(900);
    const [{ id: seededId }] = await upsertSourceRecords(sourceId, [preExistingRecord], new Date(Date.now() - 60_000));
    expect(seededId).toBeDefined();

    // The generator ignores the abort signal: a slow pipeline keeps draining
    // records after the watchdog fired.
    snapshotMocks.open.mockImplementation(() => ({
      lastModified: 'Tue, 01 Jan 2030 00:00:00 GMT',
      records: (async function* () {
        for (let index = 0; index < PROJECT_GUTENBERG_UPSERT_BATCH_SIZE; index += 1) {
          yield fixtureRecord(index);
        }
        // Resuming the generator proves the first batch has committed. Abort
        // here rather than depending on how fast 500 database writes finish.
        controller.abort();
        for (
          let index = PROJECT_GUTENBERG_UPSERT_BATCH_SIZE;
          index < PROJECT_GUTENBERG_UPSERT_BATCH_SIZE + 100;
          index += 1
        ) {
          yield fixtureRecord(index);
        }
      })(),
      close: vi.fn(),
    }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const claimedAt = await claimQueued();
    await expect(syncProjectGutenbergMetadata({ claimedAt, signal: controller.signal })).resolves.toEqual({
      status: 'failed',
      errorSummary: TIMEOUT_SUMMARY,
    });

    const source = await sourceRow();
    expect(source).toMatchObject({ syncStatus: 'failed', lastErrorSummary: TIMEOUT_SUMMARY });
    // Only the pre-abort batch flush landed (one full batch) plus the seeded
    // record; the trailing 100 records were never written and no success happened.
    expect(await ownedRecordCount()).toBe(PROJECT_GUTENBERG_UPSERT_BATCH_SIZE + 1);
    expect(await availableOwnedRecordCount()).toBe(await ownedRecordCount());
    const [seededRow] = await db.select().from(sourceRecordTable).where(eq(sourceRecordTable.id, seededId!)).limit(1);
    expect(seededRow?.availability).toBe('available');

    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('gutenberg.org'))).toHaveLength(0);
    fetchSpy.mockRestore();
  });

  it('writes nothing more in flushBatch when the run aborts while classification evidence loads', async () => {
    flushGate.reset();

    // Gate the pre-upsert evidence read: the first flushBatch blocks here.
    let releaseGate!: () => void;
    let markReached!: () => void;
    flushGate.gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const evidenceReached = new Promise<void>((resolve) => {
      markReached = resolve;
    });
    flushGate.onEvidenceReached = markReached;

    snapshotMocks.open.mockResolvedValue(fakeSnapshot(records(3)));
    const claimedAt = await claimQueued();
    const controller = new AbortController();

    const runPromise = syncProjectGutenbergMetadata({ claimedAt, signal: controller.signal });
    await evidenceReached;
    // Simulate the sync time limit firing mid-flush, then let the evidence
    // read complete so the code path continues into the guarded section.
    controller.abort();
    releaseGate();

    const result = await runPromise;

    expect(result).toEqual({ status: 'failed', errorSummary: TIMEOUT_SUMMARY });
    // The abort must fence every remaining write in flushBatch and beyond:
    // no upsert, no incremental classification, no reconciliation, no success.
    expect(flushGate.evidenceCalls).toBeGreaterThan(0);
    expect(flushGate.upsertCalls).toBe(0);
    expect(flushGate.classificationCalls).toBe(0);
    expect(flushGate.reconcileCalls).toBe(0);
    expect(flushGate.succeededCalls).toBe(0);
    expect(await ownedRecordCount()).toBe(0);
    const source = await sourceRow();
    expect(source).toMatchObject({ syncStatus: 'failed', lastErrorSummary: TIMEOUT_SUMMARY });
  });
});
