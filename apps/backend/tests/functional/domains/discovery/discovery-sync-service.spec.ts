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
import { discoverySource as discoverySourceTable, sourceRecord as sourceRecordTable } from '@gloaming/db/schema';

import { JOB_DISCOVERY_SYNC, processDiscoverySync } from '@/application/jobs/discovery-sync';
import {
  PROJECT_GUTENBERG_RDF_SNAPSHOT_URL,
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SOURCE_TYPE,
} from '@/domains/discovery/gutenberg/constants';
import { GutenbergSnapshotError } from '@/domains/discovery/gutenberg/errors';
import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import { claimSourceQueued, ensureDiscoverySource } from '@/domains/discovery/sync/repository';
import { syncProjectGutenbergMetadata } from '@/domains/discovery/sync/service';
import { db } from '@/infra/db';
import { processJob } from '@/worker';

const snapshotMocks = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@/domains/discovery/gutenberg/snapshot-stream', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, openGutenbergSnapshot: snapshotMocks.open };
});

const runId = randomUUID();
let sourceId = '';
let preExisting: typeof discoverySourceTable.$inferSelect | null = null;

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
    const [existing] = await db
      .select()
      .from(discoverySourceTable)
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY))
      .limit(1);
    preExisting = existing ?? null;
    const source = await ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
    sourceId = source.id;
  });

  beforeEach(async () => {
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
    if (preExisting) {
      await db
        .update(discoverySourceTable)
        .set({
          enabled: preExisting.enabled,
          syncStatus: preExisting.syncStatus,
          syncStartedAt: preExisting.syncStartedAt,
          syncFinishedAt: preExisting.syncFinishedAt,
          lastSuccessAt: preExisting.lastSuccessAt,
          lastErrorSummary: preExisting.lastErrorSummary,
          snapshotLastModified: preExisting.snapshotLastModified,
          snapshotVersion: preExisting.snapshotVersion,
        })
        .where(eq(discoverySourceTable.id, sourceId));
    } else {
      await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    }
  });

  it('upserts a 501-record snapshot in bounded batches without public Gutenberg access', async () => {
    const before = await forbiddenRowCounts();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    snapshotMocks.open.mockResolvedValue(fakeSnapshot(records(501)));

    expect(await claimSourceQueued(sourceId)).toBe(true);
    const result = await syncProjectGutenbergMetadata();

    expect(result).toEqual({
      status: 'succeeded',
      lastModified: 'Tue, 01 Jan 2030 00:00:00 GMT',
      seenRecords: 501,
      unavailableRecords: 0,
      batches: 2,
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

    expect(await claimSourceQueued(sourceId)).toBe(true);
    const first = await syncProjectGutenbergMetadata();
    expect(first).toMatchObject({ status: 'succeeded', seenRecords: 20, batches: 1 });

    await resetSourceItself();
    expect(await claimSourceQueued(sourceId)).toBe(true);
    const second = await syncProjectGutenbergMetadata();
    expect(second).toMatchObject({ status: 'succeeded', seenRecords: 20, batches: 1 });

    expect(await ownedRecordCount()).toBe(20);
  });

  it('reconciles records missing from a later snapshot to unavailable and never deletes them', async () => {
    snapshotMocks.open.mockResolvedValue(fakeSnapshot(records(5)));
    expect(await claimSourceQueued(sourceId)).toBe(true);
    await syncProjectGutenbergMetadata();

    await resetSourceItself();
    snapshotMocks.open.mockResolvedValue(fakeSnapshot([fixtureRecord(0), fixtureRecord(1)]));
    expect(await claimSourceQueued(sourceId)).toBe(true);
    const result = await syncProjectGutenbergMetadata();

    expect(result).toMatchObject({ status: 'succeeded', seenRecords: 2, unavailableRecords: 3 });
    expect(await ownedRecordCount()).toBe(5);
    expect(await availableOwnedRecordCount()).toBe(2);
  });

  it('skips without fetching when the source is disabled between queueing and execution', async () => {
    expect(await claimSourceQueued(sourceId)).toBe(true);
    await db.update(discoverySourceTable).set({ enabled: false }).where(eq(discoverySourceTable.id, sourceId));

    const result = await syncProjectGutenbergMetadata();

    expect(result).toEqual({ status: 'skipped-disabled' });
    expect(snapshotMocks.open).not.toHaveBeenCalled();
    const source = await sourceRow();
    expect(source).toMatchObject({ syncStatus: 'idle', lastErrorSummary: null });
    expect(await ownedRecordCount()).toBe(0);
  });

  it('skips when no queued claim is owned', async () => {
    const result = await syncProjectGutenbergMetadata();
    expect(result).toEqual({ status: 'skipped-not-queued' });
    expect(snapshotMocks.open).not.toHaveBeenCalled();
  });

  it('records a sanitized failure status when the snapshot pipeline fails', async () => {
    snapshotMocks.open.mockResolvedValue(
      failingSnapshot(new GutenbergSnapshotError('an RDF member could not be parsed')),
    );

    expect(await claimSourceQueued(sourceId)).toBe(true);
    const result = await syncProjectGutenbergMetadata();

    expect(result).toEqual({ status: 'failed', errorSummary: 'an RDF member could not be parsed' });
    const source = await sourceRow();
    expect(source?.syncStatus).toBe('failed');
    expect(source?.lastErrorSummary).toBe('an RDF member could not be parsed');
  });

  it('runs through the worker job and surfaces result and error', async () => {
    snapshotMocks.open.mockResolvedValue(fakeSnapshot(records(3)));
    expect(await claimSourceQueued(sourceId)).toBe(true);

    await expect(
      processJob({ name: JOB_DISCOVERY_SYNC, data: { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY } }),
    ).resolves.toEqual({ status: 'succeeded' });

    await expect(processDiscoverySync({ sourceKey: 'unsupported-source' })).rejects.toBeInstanceOf(UnrecoverableError);

    snapshotMocks.open.mockResolvedValue(
      failingSnapshot(new GutenbergSnapshotError('an RDF member could not be parsed')),
    );
    await resetSourceItself();
    expect(await claimSourceQueued(sourceId)).toBe(true);
    await expect(processDiscoverySync({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY })).rejects.toThrow(
      'an RDF member could not be parsed',
    );
  });
});
