import { randomUUID } from 'node:crypto';

import { and, count, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readingPart as readingPartTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  user as userTable,
} from '@gloaming/db';
import { discoverySource as discoverySourceTable, sourceRecord as sourceRecordTable } from '@gloaming/db/schema';

import { PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE } from '@/domains/discovery/gutenberg/constants';
import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import { claimSourceQueued, ensureDiscoverySource, upsertSourceRecords } from '@/domains/discovery/sync/repository';
import { syncProjectGutenbergMetadata } from '@/domains/discovery/sync/service';
import { db } from '@/infra/db';

const snapshotMocks = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@/domains/discovery/gutenberg/snapshot-stream', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, openGutenbergSnapshot: snapshotMocks.open };
});

/** Captured log calls so the `updatedWorkMetadata` observability counter can be asserted. */
const logCapture = vi.hoisted(() => ({ calls: [] as Array<{ payload: unknown; message: unknown }> }));

vi.mock('@/infra/logging/logger', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const fake: Record<string, unknown> = {
    level: 'info',
    info: (payload: unknown, message: unknown) => logCapture.calls.push({ payload, message }),
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    fatal: () => undefined,
    trace: () => undefined,
    child: () => fake,
  };
  return { ...actual, rootLogger: fake };
});

const runId = randomUUID();
let sourceId = '';
let progressUserId = '';
const createdWorkIds: string[] = [];

function fixtureRecord(index: number, overrides: Partial<ParsedSourceRecord> = {}): ParsedSourceRecord {
  return {
    externalId: `${runId}-wm-${index}`,
    title: `Work metadata fixture ${index}`,
    authors: [{ name: `Sync Author ${index}`, role: 'author' }],
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

async function sourceRecordRow(index: number) {
  const [row] = await db
    .select()
    .from(sourceRecordTable)
    .where(and(eq(sourceRecordTable.sourceId, sourceId), eq(sourceRecordTable.externalId, `${runId}-wm-${index}`)))
    .limit(1);
  return row;
}

type CreateLinkedWorkInput = {
  title: string;
  description: string;
  processingStatus?: string;
};

/** Minimal linked Work + one Part + one reader's progress, mirroring a materialized discovery Work. */
async function createLinkedWork(
  index: number,
  input: CreateLinkedWorkInput,
): Promise<{ workId: string; partId: string; stateId: string }> {
  const workId = randomUUID();
  const partId = randomUUID();
  const stateId = randomUUID();
  await db.insert(readingWorkTable).values({
    id: workId,
    title: input.title,
    author: 'Stay Author',
    description: input.description,
    language: 'en',
    processingStatus: input.processingStatus ?? 'ready',
    ownerUserId: null,
    visibility: 'catalog',
    publishedAt: null,
    coverAssetId: randomUUID(),
    wordCount: 4242,
    descriptionProvenance: 'extracted',
  });
  createdWorkIds.push(workId);
  await db.insert(readingPartTable).values({
    id: partId,
    workId,
    sortOrder: 0,
    title: 'Fixture part title',
    body: 'Fixture part body',
  });
  await db.insert(readingStateTable).values({
    id: stateId,
    userId: progressUserId,
    workId,
    currentPartId: partId,
    completedThroughSortOrder: 3,
    revision: 7,
    status: 'in_progress',
  });
  // The SourceRecord → Work link is the materialization SSOT.
  await db
    .update(sourceRecordTable)
    .set({ workId, materializationStatus: 'ready' })
    .where(and(eq(sourceRecordTable.sourceId, sourceId), eq(sourceRecordTable.externalId, `${runId}-wm-${index}`)));
  return { workId, partId, stateId };
}

async function workRow(workId: string) {
  const [row] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  return row;
}

async function partRow(partId: string) {
  const [row] = await db.select().from(readingPartTable).where(eq(readingPartTable.id, partId)).limit(1);
  return row;
}

async function stateRow(stateId: string) {
  const [row] = await db.select().from(readingStateTable).where(eq(readingStateTable.id, stateId)).limit(1);
  return row;
}

function lastSucceededLog(): { payload: Record<string, unknown>; message: unknown } | undefined {
  const calls = logCapture.calls.filter((call) => call.message === 'Gutenberg metadata sync succeeded');
  const last = calls.at(-1);
  return last ? { payload: last.payload as Record<string, unknown>, message: last.message } : undefined;
}

async function ownedWorkCount(): Promise<number> {
  const works = await db.select({ value: count() }).from(readingWorkTable);
  return Number(works[0]?.value ?? 0);
}

describe('Discovery sync work metadata write-back on gloaming_test', () => {
  beforeAll(async () => {
    const source = await ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
    sourceId = source.id;
    progressUserId = randomUUID();
    await db.insert(userTable).values({
      id: progressUserId,
      name: 'Work Metadata Progress User',
      email: `${progressUserId}@example.com`,
    });
  });

  beforeEach(async () => {
    snapshotMocks.open.mockReset();
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
      // Part/state rows cascade with their Work; only fixture rows are removed.
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
    await db.delete(userTable).where(eq(userTable.id, progressUserId));
    await resetSourceItself();
  });

  it('updates title and description of a linked Work while parts and progress stay untouched', async () => {
    await seedSourceRecord({ title: 'Legacy Title', description: 'Legacy description' });
    const { workId, partId, stateId } = await createLinkedWork(1, {
      title: 'Legacy Title',
      description: 'Legacy description',
    });
    const before = await workRow(workId);
    const partBefore = await partRow(partId);
    const stateBefore = await stateRow(stateId);

    snapshotMocks.open.mockResolvedValue(
      fakeSnapshot([fixtureRecord(1, { title: 'Refreshed Title', description: 'Refreshed description' })]),
    );
    const result = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
    expect(result).toMatchObject({ status: 'succeeded', seenRecords: 1, batches: 1 });

    const work = await workRow(workId);
    expect(work).toMatchObject({
      title: 'Refreshed Title',
      description: 'Refreshed description',
      // Only title/description flow back: author, cover, stats, status stay put.
      author: before?.author,
      coverAssetId: before?.coverAssetId,
      processingStatus: 'ready',
      wordCount: before?.wordCount,
      descriptionProvenance: before?.descriptionProvenance,
    });
    // Postgres timestamps are truncated to milliseconds, so an update within
    // the same millisecond as the old value may leave updatedAt equal, not
    // strictly greater. title/description assertions above stay strict to
    // prove the row was actually written.
    expect(work?.updatedAt?.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime());

    expect(await partRow(partId)).toEqual(partBefore);
    expect(await stateRow(stateId)).toEqual(stateBefore);

    const record = await sourceRecordRow(1);
    expect(record).toMatchObject({ title: 'Refreshed Title', description: 'Refreshed description', workId });

    expect(lastSucceededLog()?.payload).toMatchObject({ updatedWorkMetadata: 1 });
  });

  it('writes nothing when snapshot title and description are unchanged', async () => {
    await seedSourceRecord({ title: 'Stable Title', description: 'Stable description' });
    const { workId } = await createLinkedWork(1, { title: 'Stable Title', description: 'Stable description' });
    const before = await workRow(workId);

    snapshotMocks.open.mockResolvedValue(
      fakeSnapshot([fixtureRecord(1, { title: 'Stable Title', description: 'Stable description' })]),
    );
    const result = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
    expect(result).toMatchObject({ status: 'succeeded' });

    // Same value → no write at all, including the row's updatedAt timestamp.
    expect(await workRow(workId)).toEqual(before);
    expect(lastSucceededLog()?.payload).toMatchObject({ updatedWorkMetadata: 0 });
  });

  it('leaves Works alone for changed records without a work link', async () => {
    await seedSourceRecord({ title: 'Unlinked Title', description: 'Unlinked description' });
    const worksBefore = await ownedWorkCount();

    snapshotMocks.open.mockResolvedValue(
      fakeSnapshot([fixtureRecord(1, { title: 'Unlinked New Title', description: 'Unlinked new description' })]),
    );
    const result = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
    expect(result).toMatchObject({ status: 'succeeded' });

    expect(await ownedWorkCount()).toBe(worksBefore);
    const record = await sourceRecordRow(1);
    expect(record).toMatchObject({ title: 'Unlinked New Title', workId: null });
    expect(lastSucceededLog()?.payload).toMatchObject({ updatedWorkMetadata: 0 });
  });

  it('never force-writes a failed Work even though the source record changes', async () => {
    await seedSourceRecord({ title: 'Failed Title', description: 'Failed description' });
    const { workId } = await createLinkedWork(1, {
      title: 'Failed Title',
      description: 'Failed description',
      processingStatus: 'failed',
    });
    const before = await workRow(workId);

    snapshotMocks.open.mockResolvedValue(
      fakeSnapshot([fixtureRecord(1, { title: 'Failed New Title', description: 'Failed new description' })]),
    );
    const result = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
    expect(result).toMatchObject({ status: 'succeeded' });

    expect(await workRow(workId)).toEqual(before);
    const record = await sourceRecordRow(1);
    expect(record).toMatchObject({ title: 'Failed New Title', workId });
    expect(lastSucceededLog()?.payload).toMatchObject({ updatedWorkMetadata: 0 });
  });

  it('flows a null source description onto the Work as an empty string', async () => {
    await seedSourceRecord({ title: 'Null desc title', description: 'Has description' });
    const { workId } = await createLinkedWork(1, { title: 'Null desc title', description: 'Has description' });

    snapshotMocks.open.mockResolvedValue(
      fakeSnapshot([fixtureRecord(1, { title: 'Null desc title', description: null })]),
    );
    const result = await syncProjectGutenbergMetadata({ claimedAt: await claimQueued() });
    expect(result).toMatchObject({ status: 'succeeded' });

    const work = await workRow(workId);
    expect(work).toMatchObject({ title: 'Null desc title', description: '' });
    expect(lastSucceededLog()?.payload).toMatchObject({ updatedWorkMetadata: 1 });
  });
});
