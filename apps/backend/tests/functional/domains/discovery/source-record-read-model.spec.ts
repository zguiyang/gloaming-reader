import { randomUUID } from 'node:crypto';

import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
  categorySourceRecordListQuerySchema,
  sourceRecordDetailSchema,
  sourceRecordListDataSchema,
  sourceRecordListQuerySchema,
} from '@gloaming/shared/discovery';

import app from '@/app';
import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import { getSourceRecord, listAdminSourceRecords, listSourceRecords } from '@/domains/discovery/read-model';
import {
  ensureDiscoverySource,
  reconcileUnavailableRecords,
  upsertSourceRecords,
} from '@/domains/discovery/sync/repository';
import { db } from '@/infra/db';
import { putObject, resetObjectStoreCache, setObjectStoreForTests } from '@/infra/storage';

import { createMemoryObjectStore } from '../../../helpers/memory-oss';

vi.mock('@/infra/auth/mail', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendAuthMail: vi.fn().mockResolvedValue(undefined),
}));

const runId = randomUUID();
const sourceKey = `read_model_${runId}`;
let sourceId = '';
const linkedWorkIds: string[] = [];

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

async function listAdminAll(input: Record<string, unknown> = {}) {
  const query = categorySourceRecordListQuerySchema.parse({ pageSize: 50, ...input });
  return listAdminSourceRecords(query);
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

/** Minimal readable Work used only to exercise the explicit SourceRecord → Work link. */
async function createLinkedWorkFixture(title: string): Promise<string> {
  const id = randomUUID();
  await db.insert(readingWorkTable).values({
    id,
    title,
    author: '',
    description: '',
    language: 'en',
    processingStatus: 'ready',
    ownerUserId: null,
    visibility: 'catalog',
    publishedAt: null,
  });
  linkedWorkIds.push(id);
  return id;
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
          contentCandidates: [
            { format: 'epub', url: 'https://www.gutenberg.org/ebooks/1342.epub.images', sizeBytes: 10 },
          ],
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
    for (const workId of linkedWorkIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
  });

  it('lists only available English records for enabled sources by default', async () => {
    const data = await listAll();
    const ids = data.items.map((item) => item.externalId);
    expect(ids).toEqual(expect.arrayContaining([`${runId}-1`, `${runId}-2`, `${runId}-4`]));
    expect(ids).not.toContain(`${runId}-3`);
    expect(data.pagination.total).toBe(3);
    expect(data.pagination.sortBy).toBe('sourceUpdatedAt');
  });

  it('marks isSaveable from synced EPUB candidates without exposing them on the list', async () => {
    const data = await listAll();
    const byExternalId = new Map(data.items.map((item) => [item.externalId, item]));

    // Only `${runId}-1` carries an official Gutenberg EPUB candidate.
    expect(byExternalId.get(`${runId}-1`)?.isSaveable).toBe(true);
    expect(byExternalId.get(`${runId}-2`)?.isSaveable).toBe(false);
    expect(byExternalId.get(`${runId}-4`)?.isSaveable).toBe(false);

    // Candidate data is computed server-side only; it never leaks into the list DTO.
    for (const item of data.items) {
      expect(item).not.toHaveProperty('contentCandidates');
    }
    expect(sourceRecordListDataSchema.parse(data)).toEqual(data);
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
      contentCandidates: [{ format: 'epub', url: 'https://www.gutenberg.org/ebooks/1342.epub.images', sizeBytes: 10 }],
      sourceMeta: { subjects: ['Fiction'], bookshelves: ['Best Books Ever'] },
      availability: 'available',
      isSaveable: true,
    });
    expect(detail).not.toHaveProperty('readingWorkId');
    expect(detail.linkedWorkId).toBeNull();
  });

  it('projects the linked ReadingWork id separately from the Discover identity', async () => {
    const row = await recordRow(`${runId}-1`);
    const workId = await createLinkedWorkFixture('Linked Work');
    await db.update(sourceRecordTable).set({ workId }).where(eq(sourceRecordTable.id, row!.id));

    try {
      const listed = (await listAll({ q: `${runId}-1` })).items[0];
      expect(listed?.sourceRecordId).toBe(row!.id);
      expect(listed?.linkedWorkId).toBe(workId);

      const detail = await getSourceRecord(row!.id);
      expect(detail.sourceRecordId).toBe(row!.id);
      expect(detail.linkedWorkId).toBe(workId);
      expect(sourceRecordDetailSchema.parse(detail).linkedWorkId).toBe(workId);
    } finally {
      await db.update(sourceRecordTable).set({ workId: null }).where(eq(sourceRecordTable.id, row!.id));
    }
  });

  it('projects detailAvailable from the Work Access Policy for anonymous, member, and non-member viewers', async () => {
    const row = await recordRow(`${runId}-1`);
    const workId = await createLinkedWorkFixture('Gated Detail Work');
    await db.update(sourceRecordTable).set({ workId }).where(eq(sourceRecordTable.id, row!.id));
    const member = await createUserSession();
    const outsider = await createUserSession();
    await db.insert(userLibraryItemTable).values({ id: randomUUID(), userId: member.userId, workId });

    type AvailabilityPayload = { detailAvailable?: boolean; linkedWorkId?: string | null };
    const readList = async (cookie?: string): Promise<AvailabilityPayload | undefined> => {
      const response = await app.request(`/api/discover/records?q=${encodeURIComponent(`${runId}-1`)}`, {
        headers: cookie ? { cookie } : {},
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as { items: AvailabilityPayload[] };
      return data.items[0];
    };
    const readDetail = async (cookie?: string): Promise<AvailabilityPayload> => {
      const response = await app.request(`/api/discover/records/${row!.id}`, {
        headers: cookie ? { cookie } : {},
      });
      expect(response.status).toBe(200);
      return (await response.json()) as AvailabilityPayload;
    };

    try {
      // Anonymous viewer: an unpublished ownerless source-linked Work stays closed,
      // and the list and detail projections agree.
      expect(await readList()).toMatchObject({ linkedWorkId: workId, detailAvailable: false });
      expect(await readDetail()).toMatchObject({ linkedWorkId: workId, detailAvailable: false });

      // The Work's own Library member may open the detail page.
      expect(await readList(member.cookie)).toMatchObject({ detailAvailable: true });
      expect(await readDetail(member.cookie)).toMatchObject({ detailAvailable: true });

      // Another signed-in viewer without a membership inherits nothing.
      expect(await readList(outsider.cookie)).toMatchObject({ detailAvailable: false });
      expect(await readDetail(outsider.cookie)).toMatchObject({ detailAvailable: false });

      // Parse not completed: even the member loses the entry (read-model gate).
      await db.update(readingWorkTable).set({ processingStatus: 'processing' }).where(eq(readingWorkTable.id, workId));
      expect(await readList(member.cookie)).toMatchObject({ detailAvailable: false });
      expect(await readDetail(member.cookie)).toMatchObject({ detailAvailable: false });
      await db.update(readingWorkTable).set({ processingStatus: 'ready' }).where(eq(readingWorkTable.id, workId));

      // A published ownerless Catalog Work is readable by every viewer.
      await db.update(readingWorkTable).set({ publishedAt: new Date() }).where(eq(readingWorkTable.id, workId));
      expect(await readList()).toMatchObject({ detailAvailable: true });
      expect(await readDetail()).toMatchObject({ detailAvailable: true });
    } finally {
      await db.delete(userLibraryItemTable).where(eq(userLibraryItemTable.workId, workId));
      await db.delete(userTable).where(eq(userTable.id, member.userId));
      await db.delete(userTable).where(eq(userTable.id, outsider.userId));
      await db.update(sourceRecordTable).set({ workId: null }).where(eq(sourceRecordTable.id, row!.id));
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
  });

  it('admin candidate search surfaces records hidden from public Discover', async () => {
    const anonymous = await app.request(`/api/admin/discovery/source-records?q=${runId}`);
    expect(anonymous.status).toBe(401);

    const unavailableId = `${runId}-4`;
    const expectedRunIds = [`${runId}-1`, `${runId}-2`, `${runId}-3`, unavailableId];
    await db
      .update(sourceRecordTable)
      .set({ availability: 'unavailable' })
      .where(and(eq(sourceRecordTable.sourceId, sourceId), eq(sourceRecordTable.externalId, unavailableId)));

    try {
      // Every assertion is bounded to this run's unique runId term, so pre-existing
      // SourceRecords in gloaming_test can never affect the counts.

      // Public Discover keeps only the available English records: `${runId}-3` is
      // non-English and `${runId}-4` is unavailable.
      const publicData = await listAll({ q: runId });
      expect(publicData.items.map((item) => item.externalId).sort()).toEqual([`${runId}-1`, `${runId}-2`].sort());
      expect(publicData.pagination.total).toBe(2);

      // Admin candidate search sees every record of the run, including hidden ones.
      const adminData = await listAdminAll({ q: runId });
      expect(adminData.items.map((item) => item.externalId).sort()).toEqual(expectedRunIds.slice().sort());
      expect(adminData.pagination.total).toBe(4);
      expect(sourceRecordListDataSchema.parse(adminData)).toEqual(adminData);

      // A narrower admin term still narrows within the run.
      expect((await listAdminAll({ q: `${runId}-3` })).items.map((item) => item.externalId)).toEqual([`${runId}-3`]);

      // Disabling the owning source hides the whole run from public Discover but
      // not from admin.
      await db.update(discoverySourceTable).set({ enabled: false }).where(eq(discoverySourceTable.id, sourceId));

      const hiddenPublicData = await listAll({ q: runId });
      expect(hiddenPublicData.items).toHaveLength(0);
      expect(hiddenPublicData.pagination.total).toBe(0);

      const adminDisabledData = await listAdminAll({ q: runId });
      expect(adminDisabledData.items.map((item) => item.externalId).sort()).toEqual(expectedRunIds.slice().sort());
      expect(adminDisabledData.pagination.total).toBe(4);
    } finally {
      await db.update(discoverySourceTable).set({ enabled: true }).where(eq(discoverySourceTable.id, sourceId));
      await db
        .update(sourceRecordTable)
        .set({ availability: 'available' })
        .where(and(eq(sourceRecordTable.sourceId, sourceId), eq(sourceRecordTable.externalId, unavailableId)));
    }
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

  async function createUserSession(): Promise<{ userId: string; cookie: string }> {
    const email = `read_model_cover_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
    const username = `rc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const signup = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password: 'password123', name: 'cover', username }),
    });
    expect(signup.status).toBe(200);
    await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
    const login = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    expect(login.status).toBe(200);
    const getSetCookie = (login.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const cookie = getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
    const [user] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
    return { userId: user!.id, cookie };
  }

  it('projects the local cover only when the viewer may read the linked Work', async () => {
    const row = await recordRow(`${runId}-1`);
    const sourceCover = `https://example.test/${runId}/cover.jpg`;
    const workId = await createLinkedWorkFixture('Cover Source Work');
    const assetId = randomUUID();
    await db.insert(contentAssetTable).values({
      id: assetId,
      workId,
      kind: 'cover',
      storageKey: `covers/${assetId}/cover-v1.webp`,
      mimeType: 'image/webp',
      contentHash: assetId,
      status: 'ready',
    });
    await db.update(readingWorkTable).set({ coverAssetId: assetId }).where(eq(readingWorkTable.id, workId));
    await db.update(sourceRecordTable).set({ workId, coverUrl: sourceCover }).where(eq(sourceRecordTable.id, row!.id));
    const session = await createUserSession();
    const otherSession = await createUserSession();
    await db.insert(userLibraryItemTable).values({ id: randomUUID(), userId: session.userId, workId });
    const memory = createMemoryObjectStore();
    setObjectStoreForTests(memory);
    await putObject({
      key: `covers/${assetId}/cover-v1.webp`,
      body: Buffer.from([0x52, 0x49, 0x46, 0x46]),
      contentType: 'image/webp',
    });

    try {
      // Unpublished ownerless Source Work: the asset gateway forbids anonymous
      // reads, so Discover must keep serving the source cover URL.
      expect((await app.request(`/api/assets/${assetId}`)).status).toBe(403);
      const anonymousList = await app.request(`/api/discover/records?q=${encodeURIComponent(`${runId}-1`)}`);
      const anonymousItems = (await anonymousList.json()) as { items: Array<{ coverUrl: string | null }> };
      expect(anonymousItems.items[0]?.coverUrl).toBe(sourceCover);
      const anonymousDetail = (await (await app.request(`/api/discover/records/${row!.id}`)).json()) as {
        coverUrl: string | null;
      };
      expect(anonymousDetail.coverUrl).toBe(sourceCover);

      // The linked Work's own Library member may read the local cover asset.
      expect((await app.request(`/api/assets/${assetId}`, { headers: { cookie: session.cookie } })).status).toBe(200);
      const memberList = (await (
        await app.request(`/api/discover/records?q=${encodeURIComponent(`${runId}-1`)}`, {
          headers: { cookie: session.cookie },
        })
      ).json()) as { items: Array<{ coverUrl: string | null }> };
      expect(memberList.items[0]?.coverUrl).toBe(`/api/assets/${assetId}`);
      const memberDetail = (await (
        await app.request(`/api/discover/records/${row!.id}`, { headers: { cookie: session.cookie } })
      ).json()) as { coverUrl: string | null };
      expect(memberDetail.coverUrl).toBe(`/api/assets/${assetId}`);

      // Another authenticated viewer has no membership and must not inherit
      // the preceding member request's local cover projection.
      expect((await app.request(`/api/assets/${assetId}`, { headers: { cookie: otherSession.cookie } })).status).toBe(
        403,
      );
      const otherDetail = (await (
        await app.request(`/api/discover/records/${row!.id}`, { headers: { cookie: otherSession.cookie } })
      ).json()) as { coverUrl: string | null };
      expect(otherDetail.coverUrl).toBe(sourceCover);
      const otherList = (await (
        await app.request(`/api/discover/records?q=${encodeURIComponent(`${runId}-1`)}`, {
          headers: { cookie: otherSession.cookie },
        })
      ).json()) as { items: Array<{ coverUrl: string | null }> };
      expect(otherList.items[0]?.coverUrl).toBe(sourceCover);

      // A published Catalog Work proves the local cover readable for everyone.
      await db.update(readingWorkTable).set({ publishedAt: new Date() }).where(eq(readingWorkTable.id, workId));
      expect((await app.request(`/api/assets/${assetId}`)).status).toBe(200);
      const publishedList = (await (
        await app.request(`/api/discover/records?q=${encodeURIComponent(`${runId}-1`)}`)
      ).json()) as { items: Array<{ coverUrl: string | null }> };
      expect(publishedList.items[0]?.coverUrl).toBe(`/api/assets/${assetId}`);
    } finally {
      await db.delete(userLibraryItemTable).where(eq(userLibraryItemTable.workId, workId));
      await db.delete(userTable).where(eq(userTable.id, session.userId));
      await db.delete(userTable).where(eq(userTable.id, otherSession.userId));
      await db.delete(contentAssetTable).where(eq(contentAssetTable.id, assetId));
      await db.update(sourceRecordTable).set({ workId: null, coverUrl: null }).where(eq(sourceRecordTable.id, row!.id));
      resetObjectStoreCache();
    }
  });
});
