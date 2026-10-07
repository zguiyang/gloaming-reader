import { randomUUID } from 'node:crypto';

import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  user as userTable,
  userLibraryItem as userLibraryItemTable,
} from '@gloaming/db';
import { discoverySource as discoverySourceTable, sourceRecord as sourceRecordTable } from '@gloaming/db/schema';
import {
  sourceRecordDetailSchema,
  sourceRecordListDataSchema,
  sourceRecordListQuerySchema,
} from '@gloaming/shared/discovery';

import app from '@/app';
import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import { getSourceRecord, listSourceRecords } from '@/domains/discovery/read-model';
import {
  ensureDiscoverySource,
  reconcileUnavailableRecords,
  upsertSourceRecords,
} from '@/domains/discovery/sync/repository';
import { db } from '@/infra/db';

const runId = randomUUID();
const sourceKey = `read_model_${runId}`;
let sourceId = '';

const observedAt = new Date('2030-01-01T00:00:00.000Z');

function fixtureRecord(index: number, overrides: Partial<ParsedSourceRecord> = {}): ParsedSourceRecord {
  return {
    externalId: `${runId}-${index}`,
    title: `Fixture ${index}`,
    authors: [{ name: `Author ${index}`, role: 'author' }],
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

function toQuery(input: Record<string, unknown> = {}) {
  return sourceRecordListQuerySchema.parse(input);
}

async function listAll(input: Record<string, unknown> = {}) {
  const query = toQuery({ pageSize: 50, ...input });
  return listSourceRecords(query);
}

async function forbiddenRowCounts(): Promise<Record<string, number>> {
  const [works, parts, assets, state, library, users] = await Promise.all([
    db.select({ value: count() }).from(readingWorkTable),
    db.select({ value: count() }).from(readingPartTable),
    db.select({ value: count() }).from(contentAssetTable),
    db.select({ value: count() }).from(readingStateTable),
    db.select({ value: count() }).from(userLibraryItemTable),
    db.select({ value: count() }).from(userTable),
  ]);
  return {
    readingWork: Number(works[0]?.value ?? 0),
    readingPart: Number(parts[0]?.value ?? 0),
    contentAsset: Number(assets[0]?.value ?? 0),
    readingState: Number(state[0]?.value ?? 0),
    userLibraryItem: Number(library[0]?.value ?? 0),
    user: Number(users[0]?.value ?? 0),
  };
}

async function recordRow(externalId: string) {
  const [row] = await db
    .select()
    .from(sourceRecordTable)
    .where(and(eq(sourceRecordTable.sourceId, sourceId), eq(sourceRecordTable.externalId, externalId)))
    .limit(1);
  return row;
}

describe('SourceRecord read model on gloaming_test', () => {
  beforeAll(async () => {
    const source = await ensureDiscoverySource(sourceKey, 'gutenberg_rdf');
    sourceId = source.id;
    await upsertSourceRecords(
      sourceId,
      [
        fixtureRecord(1, {
          title: 'Alpha Discovery',
          authors: [{ name: 'Zed Author', role: 'author' }],
          rightsStatement: 'Public domain in the USA.',
          contentCandidates: [{ format: 'epub', url: `https://example.test/${runId}/1.epub`, sizeBytes: 10 }],
          sourceMeta: { subjects: ['Fiction'], bookshelves: ['Best Books Ever'] },
          sourceUpdatedAt: new Date('2024-03-01T00:00:00.000Z'),
        }),
        fixtureRecord(2, {
          title: 'Beta Discovery',
          authors: [{ name: 'Anne Writer', role: 'author' }],
          languages: ['en', 'fr'],
          sourceUpdatedAt: new Date('2024-02-01T00:00:00.000Z'),
        }),
        fixtureRecord(3, {
          title: 'Gamma Francais',
          languages: ['fr'],
          sourceUpdatedAt: new Date('2024-01-01T00:00:00.000Z'),
        }),
        fixtureRecord(4, { title: 'Delta Discovery', sourceUpdatedAt: new Date('2024-04-01T00:00:00.000Z') }),
      ],
      observedAt,
    );
  });

  afterAll(async () => {
    await db.delete(sourceRecordTable).where(eq(sourceRecordTable.sourceId, sourceId));
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
  });

  it('lists only available English records for enabled sources by default', async () => {
    const data = await listAll();
    const ids = data.items.map((item) => item.externalId);
    expect(ids).toEqual(expect.arrayContaining([`${runId}-1`, `${runId}-2`, `${runId}-4`]));
    expect(ids).not.toContain(`${runId}-3`);
    expect(data.pagination.total).toBe(3);
    expect(data.pagination.sortBy).toBe('sourceUpdatedAt');
  });

  it('filters by an explicit language while preserving non-English persisted records', async () => {
    const french = await listAll({ language: 'fr' });
    expect(french.items.map((item) => item.externalId).sort()).toEqual([`${runId}-2`, `${runId}-3`].sort());

    const [row] = await db
      .select({ languages: sourceRecordTable.languages })
      .from(sourceRecordTable)
      .where(and(eq(sourceRecordTable.sourceId, sourceId), eq(sourceRecordTable.externalId, `${runId}-3`)))
      .limit(1);
    expect(row?.languages).toEqual(['fr']);
  });

  it('searches title, author name, and source-scoped external id', async () => {
    expect((await listAll({ q: 'Beta' })).items.map((item) => item.externalId)).toEqual([`${runId}-2`]);
    expect((await listAll({ q: 'Zed Author' })).items.map((item) => item.externalId)).toEqual([`${runId}-1`]);
    expect((await listAll({ q: `${runId}-4` })).items.map((item) => item.externalId)).toEqual([`${runId}-4`]);
  });

  it('paginates and sorts without duplicating or leaking records', async () => {
    const page1 = await listAll({ page: 1, pageSize: 2, sortBy: 'title', sortOrder: 'asc' });
    const page2 = await listAll({ page: 2, pageSize: 2, sortBy: 'title', sortOrder: 'asc' });

    expect(page1.items.map((item) => item.title)).toEqual(['Alpha Discovery', 'Beta Discovery']);
    expect(page2.items.map((item) => item.title)).toEqual(['Delta Discovery']);
    expect(page1.pagination).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2, sortBy: 'title' });
  });

  it('returns SourceRecord detail without any ReadingWork linkage', async () => {
    const [row] = await db
      .select({ id: sourceRecordTable.id })
      .from(sourceRecordTable)
      .where(and(eq(sourceRecordTable.sourceId, sourceId), eq(sourceRecordTable.externalId, `${runId}-1`)))
      .limit(1);

    const detail = await getSourceRecord(row!.id);
    expect(sourceRecordDetailSchema.parse(detail)).toEqual(detail);
    expect(detail).toMatchObject({
      sourceRecordId: row!.id,
      sourceId,
      sourceKey,
      externalId: `${runId}-1`,
      rightsStatement: 'Public domain in the USA.',
      contentCandidates: [{ format: 'epub', url: `https://example.test/${runId}/1.epub`, sizeBytes: 10 }],
      sourceMeta: { subjects: ['Fiction'], bookshelves: ['Best Books Ever'] },
      availability: 'available',
    });
    expect(detail).not.toHaveProperty('readingWorkId');
  });

  it('hides records from disabled sources and returns 404 for their detail', async () => {
    const [row] = await db
      .select({ id: sourceRecordTable.id })
      .from(sourceRecordTable)
      .where(and(eq(sourceRecordTable.sourceId, sourceId), eq(sourceRecordTable.externalId, `${runId}-1`)))
      .limit(1);

    await db.update(discoverySourceTable).set({ enabled: false }).where(eq(discoverySourceTable.id, sourceId));
    expect((await listAll()).items).toHaveLength(0);
    await expect(getSourceRecord(row!.id)).rejects.toMatchObject({ statusCode: 404 });

    const response = await app.request(`/api/discover/records/${row!.id}`);
    expect(response.status).toBe(404);

    await db.update(discoverySourceTable).set({ enabled: true }).where(eq(discoverySourceTable.id, sourceId));
  });

  it('hides unavailable records from list and detail', async () => {
    await db
      .update(sourceRecordTable)
      .set({ availability: 'unavailable' })
      .where(and(eq(sourceRecordTable.sourceId, sourceId), eq(sourceRecordTable.externalId, `${runId}-4`)));

    const listed = await listAll();
    expect(listed.items.map((item) => item.externalId)).not.toContain(`${runId}-4`);

    const hidden = await recordRow(`${runId}-4`);
    await expect(getSourceRecord(hidden!.id)).rejects.toMatchObject({ statusCode: 404 });

    const response = await app.request(`/api/discover/records/${hidden!.id}`);
    expect(response.status).toBe(404);
  });

  it('reconciles unobserved records to unavailable without deleting them', async () => {
    const reconciledAt = new Date(observedAt.getTime() + 60_000);
    const updated = await reconcileUnavailableRecords(sourceId, reconciledAt);
    expect(updated).toBe(4);

    const remaining = await db
      .select({ value: count() })
      .from(sourceRecordTable)
      .where(eq(sourceRecordTable.sourceId, sourceId));
    expect(Number(remaining[0]?.value ?? 0)).toBe(4);
    expect((await listAll()).items).toHaveLength(0);
  });

  it('upserts idempotently, reactivating records and preserving identity and createdAt', async () => {
    const before = await recordRow(`${runId}-1`);
    expect(before?.availability).toBe('unavailable');

    await upsertSourceRecords(sourceId, [fixtureRecord(1, { title: 'Alpha Discovery (updated)' })], observedAt);

    const after = await recordRow(`${runId}-1`);
    expect(after?.id).toBe(before!.id);
    expect(after?.createdAt.getTime()).toBe(before!.createdAt.getTime());
    expect(after?.title).toBe('Alpha Discovery (updated)');
    expect(after?.availability).toBe('available');
    expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime());

    const total = await db
      .select({ value: count() })
      .from(sourceRecordTable)
      .where(eq(sourceRecordTable.sourceId, sourceId));
    expect(Number(total[0]?.value ?? 0)).toBe(4);
  });

  it('validates the list query and rejects an unknown sort field without touching unrelated tables', async () => {
    const beforeCounts = await forbiddenRowCounts();

    const response = await app.request('/api/discover/records?sortBy=unknown');
    expect(response.status).toBe(400);

    const valid = await app.request(`/api/discover/records?pageSize=2`);
    expect(valid.status).toBe(200);
    expect(sourceRecordListDataSchema.parse(await valid.json()).pagination.pageSize).toBe(2);

    expect(await forbiddenRowCounts()).toEqual(beforeCounts);
  });
});
