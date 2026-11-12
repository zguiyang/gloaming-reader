import { randomUUID } from 'node:crypto';

import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { readingWork as readingWorkTable } from '@gloaming/db';
import { discoverySource as discoverySourceTable, sourceRecord as sourceRecordTable } from '@gloaming/db/schema';

import { workCoverRefreshJobId } from '@/application/jobs/work-cover-refresh';
import { PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE } from '@/domains/discovery/gutenberg/constants';
import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import { claimSourceQueued, ensureDiscoverySource, upsertSourceRecords } from '@/domains/discovery/sync/repository';
import { syncProjectGutenbergMetadata } from '@/domains/discovery/sync/service';
import { db } from '@/infra/db';

const queueMocks = vi.hoisted(() => ({
  enqueueWorkCoverRefresh: vi.fn(),
}));

vi.mock('@/infra/queue', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, enqueueWorkCoverRefresh: queueMocks.enqueueWorkCoverRefresh };
});

const snapshotMocks = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@/domains/discovery/gutenberg/snapshot-stream', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, openGutenbergSnapshot: snapshotMocks.open };
});

/** Captured log calls so enqueue failures and observability counters can be asserted. */
const logCapture = vi.hoisted(() => ({ calls: [] as Array<{ payload: unknown; message: unknown }> }));

vi.mock('@/infra/logging/logger', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const fake: Record<string, unknown> = {
    level: 'info',
    info: (payload: unknown, message: unknown) => logCapture.calls.push({ payload, message }),
    warn: (payload: unknown, message: unknown) => logCapture.calls.push({ payload, message }),
    error: () => undefined,
    debug: () => undefined,
    fatal: () => undefined,
    trace: () => undefined,
    child: () => fake,
  };
  return { ...actual, rootLogger: fake };
});

const runId = randomUUID();
const OLD_COVER_URL = `https://www.gutenberg.org/covers/${runId}-old.jpg`;
const NEW_COVER_URL = `https://www.gutenberg.org/covers/${runId}-new.jpg`;
let sourceId = '';
const createdWorkIds: string[] = [];

function fixtureRecord(index: number, overrides: Partial<ParsedSourceRecord> = {}): ParsedSourceRecord {
  return {
    externalId: `${runId}-cover-${index}`,
    title: `Cover refresh fixture ${index}`,
    authors: [{ name: `Cover Author ${index}`, role: 'author' }],
    languages: ['en'],
    description: null,
    rightsStatement: null,
    coverUrl: null,
    contentCandidates: [],
    sourceMeta: {},
    sourceUpdatedAt: null,
    ...overrides,
  };
}

function fakeSnapshot(records: ParsedSourceRecord[]) {
  return {
    lastModified: 'Tue, 01 Jan 2030 00:00:00 GMT',
    records: (async function* () {
      for (const record of records) {
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

async function seedSourceRecord(overrides: Partial<ParsedSourceRecord> = {}): Promise<ParsedSourceRecord> {
  const record = fixtureRecord(1, overrides);
  await upsertSourceRecords(sourceId, [record], new Date());
  return record;
}

/** Minimal linked catalog Work mirroring a materialized discovery Work. */
async function createLinkedWork(index: number, originMeta: Record<string, unknown> = {}): Promise<string> {
  const workId = randomUUID();
  await db.insert(readingWorkTable).values({
    id: workId,
    title: `Cover fixture work ${index}`,
    author: 'Cover Fixture Author',
    description: '',
    language: 'en',
    processingStatus: 'ready',
    ownerUserId: null,
    visibility: 'catalog',
    publishedAt: null,
    coverAssetId: randomUUID(),
    originMeta,
  });
  createdWorkIds.push(workId);
  await db
    .update(sourceRecordTable)
    .set({ workId, materializationStatus: 'ready' })
    .where(and(eq(sourceRecordTable.sourceId, sourceId), eq(sourceRecordTable.externalId, `${runId}-cover-${index}`)));
  return workId;
}

async function workRow(workId: string) {
  const [row] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  return row;
}

function queuedCalls(): Array<{ data: unknown; options: unknown }> {
  return queueMocks.enqueueWorkCoverRefresh.mock.calls.map((call) => ({
    data: call[0],
    options: call[1],
  }));
}

function logMessages(message: string): Array<Record<string, unknown>> {
  return logCapture.calls
    .filter((call) => call.message === message)
    .map((call) => call.payload as Record<string, unknown>);
}

describe('Discovery sync source-cover refresh detection on gloaming_test', () => {
  beforeAll(async () => {
    const source = await ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
    sourceId = source.id;
  });

  beforeEach(async () => {
    snapshotMocks.open.mockReset();
    queueMocks.enqueueWorkCoverRefresh.mockReset();
    queueMocks.enqueueWorkCoverRefresh.mockResolvedValue('job_1');
    logCapture.calls.length = 0;
    await db
      .delete(sourceRecordTable)
      .where(and(eq(sourceRecordTable.sourceId, sourceId), like(sourceRecordTable.externalId, `${runId}-%`)));
    await resetSourceItself();
  });

  afterAll(async () => {
    await db
      .delete(sourceRecordTable)
      .where(and(eq(sourceRecordTable.sourceId, sourceId), like(sourceRecordTable.externalId, `${runId}-%`)));
    for (const workId of createdWorkIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
    await resetSourceItself();
  });

  it('queues one work-cover-refresh job for a linked Work whose source cover changed', async () => {
    await seedSourceRecord({ coverUrl: OLD_COVER_URL });
    const workId = await createLinkedWork(1, { sourceCoverUrl: OLD_COVER_URL });
    const before = await workRow(workId);

    snapshotMocks.open.mockResolvedValue(fakeSnapshot([fixtureRecord(1, { coverUrl: NEW_COVER_URL })]));
    const result = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
    expect(result).toMatchObject({ status: 'succeeded', seenRecords: 1 });

    expect(queueMocks.enqueueWorkCoverRefresh).toHaveBeenCalledTimes(1);
    expect(queuedCalls()[0]).toEqual({
      data: { workId, sourceCoverUrl: NEW_COVER_URL },
      options: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 15_000 },
        jobId: workCoverRefreshJobId(workId, NEW_COVER_URL),
      },
    });

    // Detection only: the Work still shows its stored cover until the job runs.
    const after = await workRow(workId);
    expect(after?.coverAssetId).toBe(before?.coverAssetId);
    expect(after?.originMeta).toEqual(before?.originMeta);
    expect(after?.processingStatus).toBe('ready');
    expect(logMessages('Gutenberg metadata sync succeeded')[0]).toMatchObject({ coverRefreshJobs: 1 });
  });

  it('queues the first backfill when the Work never recorded a source cover marker', async () => {
    await seedSourceRecord({ coverUrl: NEW_COVER_URL });
    const workId = await createLinkedWork(1, {});

    snapshotMocks.open.mockResolvedValue(fakeSnapshot([fixtureRecord(1, { coverUrl: NEW_COVER_URL })]));
    const result = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
    expect(result).toMatchObject({ status: 'succeeded' });

    expect(queueMocks.enqueueWorkCoverRefresh).toHaveBeenCalledTimes(1);
    expect(queuedCalls()[0]!.data).toEqual({ workId, sourceCoverUrl: NEW_COVER_URL });
  });

  it('does not queue when the recorded source cover already matches', async () => {
    await seedSourceRecord({ coverUrl: NEW_COVER_URL });
    const workId = await createLinkedWork(1, { sourceCoverUrl: NEW_COVER_URL });

    snapshotMocks.open.mockResolvedValue(fakeSnapshot([fixtureRecord(1, { coverUrl: NEW_COVER_URL })]));
    const result = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
    expect(result).toMatchObject({ status: 'succeeded' });

    expect(queueMocks.enqueueWorkCoverRefresh).not.toHaveBeenCalled();
    expect((await workRow(workId))?.originMeta).toMatchObject({ sourceCoverUrl: NEW_COVER_URL });
    expect(logMessages('Gutenberg metadata sync succeeded')[0]).toMatchObject({ coverRefreshJobs: 0 });
  });

  it('does not queue for a changed cover on a record that has no Work link', async () => {
    await seedSourceRecord({ coverUrl: OLD_COVER_URL });

    snapshotMocks.open.mockResolvedValue(fakeSnapshot([fixtureRecord(1, { coverUrl: NEW_COVER_URL })]));
    const result = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
    expect(result).toMatchObject({ status: 'succeeded' });

    expect(queueMocks.enqueueWorkCoverRefresh).not.toHaveBeenCalled();
    expect(logMessages('Gutenberg metadata sync succeeded')[0]).toMatchObject({ coverRefreshJobs: 0 });
  });

  it('does not queue when the synchronized record carries no source cover', async () => {
    await seedSourceRecord({ coverUrl: OLD_COVER_URL });
    await createLinkedWork(1, { sourceCoverUrl: OLD_COVER_URL });

    snapshotMocks.open.mockResolvedValue(fakeSnapshot([fixtureRecord(1, { coverUrl: null })]));
    const result = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
    expect(result).toMatchObject({ status: 'succeeded' });

    expect(queueMocks.enqueueWorkCoverRefresh).not.toHaveBeenCalled();
    expect(logMessages('Gutenberg metadata sync succeeded')[0]).toMatchObject({ coverRefreshJobs: 0 });
  });

  it('still succeeds when the cover refresh job cannot be enqueued', async () => {
    await seedSourceRecord({ coverUrl: OLD_COVER_URL });
    const workId = await createLinkedWork(1, { sourceCoverUrl: OLD_COVER_URL });
    queueMocks.enqueueWorkCoverRefresh.mockRejectedValue(new Error('queue unavailable'));

    snapshotMocks.open.mockResolvedValue(fakeSnapshot([fixtureRecord(1, { coverUrl: NEW_COVER_URL })]));
    const result = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });

    // Metadata still commits and the run reports success; the next run re-detects.
    expect(result).toMatchObject({ status: 'succeeded' });
    const record = await db
      .select()
      .from(sourceRecordTable)
      .where(and(eq(sourceRecordTable.sourceId, sourceId), eq(sourceRecordTable.externalId, `${runId}-cover-1`)))
      .limit(1);
    expect(record[0]).toMatchObject({ coverUrl: NEW_COVER_URL, workId });
    expect(logMessages('Failed to enqueue work cover refresh')[0]).toMatchObject({ workId });
  });
});
