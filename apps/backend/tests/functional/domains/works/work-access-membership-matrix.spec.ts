import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  user as userTable,
  userLibraryItem as userLibraryItemTable,
} from '@gloaming/db';
import { discoverySource as discoverySourceTable, sourceRecord as sourceRecordTable } from '@gloaming/db/schema';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/infra/db';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/infra/storage';
import { HTTP_STATUS } from '@/shared/constants';

import { createMemoryObjectStore } from '../../../helpers/memory-oss';

const password = 'password123';
const { sendAuthMailMock } = vi.hoisted(() => ({ sendAuthMailMock: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/infra/auth/mail', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendAuthMail: sendAuthMailMock };
});

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
  const single = response.headers.get('set-cookie');
  return single ? single.split(';')[0]! : '';
}

async function createSession(role: 'user' | 'admin' = 'user') {
  const email = uniqueEmail(role);
  const username = `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const signup = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password, name: role, username }),
  });
  expect(signup.status).toBe(200);
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
  if (role === 'admin') {
    await db.update(userTable).set({ role: AUTH_ADMIN_ROLE }).where(eq(userTable.email, email));
  }
  const login = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const [user] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  return { email, cookie: cookieHeader(login), userId: user!.id };
}

const memory = createMemoryObjectStore();

type SeededWork = {
  workId: string;
  partId: string;
  coverAssetId: string;
  imageAssetId: string;
  originAssetId: string;
};

async function seedWork(input: {
  title: string;
  ownerUserId: string | null;
  visibility: 'catalog' | 'private';
  publishedAt: Date | null;
}): Promise<SeededWork> {
  const workId = randomUUID();
  const partId = randomUUID();
  const coverAssetId = randomUUID();
  const imageAssetId = randomUUID();
  const originAssetId = randomUUID();

  await db.insert(readingWorkTable).values({
    id: workId,
    title: input.title,
    processingStatus: 'ready',
    visibility: input.visibility,
    ownerUserId: input.ownerUserId,
    publishedAt: input.publishedAt,
  });
  await db.insert(readingPartTable).values({
    id: partId,
    workId,
    sortOrder: 0,
    kind: 'chapter',
    title: 'Chapter',
    body: '<p>Matrix body</p>',
    meta: {},
  });

  const coverKey = `matrix/cover/${coverAssetId}.png`;
  const imageKey = `matrix/image/${imageAssetId}.png`;
  const originKey = `matrix/origin/${originAssetId}.epub`;
  memory.store.set(coverKey, { body: Buffer.from('cover-bytes'), contentType: 'image/png' });
  memory.store.set(imageKey, { body: Buffer.from('image-bytes'), contentType: 'image/png' });
  memory.store.set(originKey, { body: Buffer.from('origin-bytes'), contentType: 'application/epub+zip' });

  await db.insert(contentAssetTable).values([
    {
      id: coverAssetId,
      workId,
      partId: null,
      kind: 'cover',
      status: 'ready',
      mimeType: 'image/png',
      storageKey: coverKey,
      contentHash: `cover-${coverAssetId}`,
      meta: {},
    },
    {
      id: imageAssetId,
      workId,
      partId,
      kind: 'image',
      status: 'ready',
      mimeType: 'image/png',
      storageKey: imageKey,
      contentHash: `image-${imageAssetId}`,
      meta: {},
    },
    {
      id: originAssetId,
      workId,
      partId: null,
      kind: 'origin_file',
      status: 'ready',
      mimeType: 'application/epub+zip',
      storageKey: originKey,
      contentHash: `origin-${originAssetId}`,
      meta: {},
    },
  ]);

  return { workId, partId, coverAssetId, imageAssetId, originAssetId };
}

describe('Work Access Policy matrix on gloaming_test', () => {
  const runId = randomUUID();
  const createdEmails: string[] = [];
  const createdWorkIds: string[] = [];
  let sourceId = '';

  function partsRequest(workId: string, cookie?: string) {
    return app.request(`/api/reader/works/${workId}/parts`, cookie ? { headers: { Cookie: cookie } } : undefined);
  }

  function assetRequest(assetId: string, cookie?: string) {
    return app.request(`/api/assets/${assetId}`, cookie ? { headers: { Cookie: cookie } } : undefined);
  }

  beforeAll(async () => {
    memory.store.clear();
    setObjectStoreForTests(memory);
    sourceId = randomUUID();
    await db.insert(discoverySourceTable).values({
      id: sourceId,
      sourceKey: `access_matrix_test_${runId}`,
      sourceType: 'gutenberg_rdf',
    });
  });

  afterAll(async () => {
    if (createdWorkIds.length) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    }
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
    resetObjectStoreCache();
  });

  it('allows only the owner to read a Personal Work across parts and every asset kind', async () => {
    const owner = await createSession();
    const other = await createSession();
    const admin = await createSession('admin');
    createdEmails.push(owner.email, other.email, admin.email);

    const work = await seedWork({
      title: 'Personal Matrix Work',
      ownerUserId: owner.userId,
      visibility: 'private',
      publishedAt: null,
    });
    createdWorkIds.push(work.workId);

    // Deliberately grant the non-owners a Library membership on the Personal Work.
    // Membership alone must never unlock another user's Personal Work.
    await db.insert(userLibraryItemTable).values([
      { id: randomUUID(), userId: other.userId, workId: work.workId },
      { id: randomUUID(), userId: admin.userId, workId: work.workId },
    ]);

    expect((await partsRequest(work.workId, owner.cookie)).status).toBe(200);
    expect((await assetRequest(work.coverAssetId, owner.cookie)).status).toBe(200);
    expect((await assetRequest(work.imageAssetId, owner.cookie)).status).toBe(200);
    expect((await assetRequest(work.originAssetId, owner.cookie)).status).toBe(200);

    for (const cookie of [other.cookie, admin.cookie]) {
      expect((await partsRequest(work.workId, cookie)).status).toBe(HTTP_STATUS.NOT_FOUND);
      expect((await assetRequest(work.coverAssetId, cookie)).status).toBe(HTTP_STATUS.FORBIDDEN);
      expect((await assetRequest(work.imageAssetId, cookie)).status).toBe(HTTP_STATUS.FORBIDDEN);
      expect((await assetRequest(work.originAssetId, cookie)).status).toBe(HTTP_STATUS.FORBIDDEN);
    }
    expect((await partsRequest(work.workId)).status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('serves published Catalog parts and learner assets publicly while denying origin_file to non-owners', async () => {
    const other = await createSession();
    const admin = await createSession('admin');
    createdEmails.push(other.email, admin.email);

    const work = await seedWork({
      title: 'Published Catalog Matrix Work',
      ownerUserId: null,
      visibility: 'catalog',
      publishedAt: new Date(),
    });
    createdWorkIds.push(work.workId);

    for (const cookie of [undefined, other.cookie, admin.cookie]) {
      expect((await partsRequest(work.workId, cookie)).status).toBe(200);
      expect((await assetRequest(work.coverAssetId, cookie)).status).toBe(200);
      expect((await assetRequest(work.imageAssetId, cookie)).status).toBe(200);
      expect((await assetRequest(work.originAssetId, cookie)).status).toBe(HTTP_STATUS.FORBIDDEN);
    }
  });

  it('does not let a Library membership unlock unlinked or non-catalog Works', async () => {
    const member = await createSession();
    const admin = await createSession('admin');
    createdEmails.push(member.email, admin.email);

    // An ownerless private Work: even a seeded membership must not grant access.
    const privateWork = await seedWork({
      title: 'Ownerless Private Matrix Work',
      ownerUserId: null,
      visibility: 'private',
      publishedAt: null,
    });
    // An ownerless unpublished catalog Work with NO source_record link.
    const unlinkedWork = await seedWork({
      title: 'Unlinked Draft Matrix Work',
      ownerUserId: null,
      visibility: 'catalog',
      publishedAt: null,
    });
    createdWorkIds.push(privateWork.workId, unlinkedWork.workId);

    await db.insert(userLibraryItemTable).values([
      { id: randomUUID(), userId: member.userId, workId: privateWork.workId },
      { id: randomUUID(), userId: member.userId, workId: unlinkedWork.workId },
      { id: randomUUID(), userId: admin.userId, workId: unlinkedWork.workId },
    ]);

    for (const work of [privateWork, unlinkedWork]) {
      for (const cookie of [member.cookie, admin.cookie]) {
        expect((await partsRequest(work.workId, cookie)).status).toBe(HTTP_STATUS.NOT_FOUND);
        expect((await assetRequest(work.coverAssetId, cookie)).status).toBe(HTTP_STATUS.FORBIDDEN);
        expect((await assetRequest(work.imageAssetId, cookie)).status).toBe(HTTP_STATUS.FORBIDDEN);
      }
    }
  });

  it('gates an unpublished Source Work on the actor own Library membership', async () => {
    const member = await createSession();
    const unsaved = await createSession();
    const admin = await createSession('admin');
    const memberAdmin = await createSession('admin');
    createdEmails.push(member.email, unsaved.email, admin.email, memberAdmin.email);

    const work = await seedWork({
      title: 'Unpublished Source Matrix Work',
      ownerUserId: null,
      visibility: 'catalog',
      publishedAt: null,
    });
    createdWorkIds.push(work.workId);

    await db.insert(sourceRecordTable).values({
      id: randomUUID(),
      sourceId,
      externalId: `${runId}-${work.workId}`,
      title: 'Unpublished Source Matrix Work',
      availability: 'available',
      workId: work.workId,
      materializationStatus: 'ready',
    });
    await db.insert(userLibraryItemTable).values({ id: randomUUID(), userId: member.userId, workId: work.workId });
    await db.insert(userLibraryItemTable).values({ id: randomUUID(), userId: memberAdmin.userId, workId: work.workId });

    // Saved user: readable Work, learner-facing assets only.
    expect((await partsRequest(work.workId, member.cookie)).status).toBe(200);
    expect((await assetRequest(work.coverAssetId, member.cookie)).status).toBe(200);
    expect((await assetRequest(work.imageAssetId, member.cookie)).status).toBe(200);
    expect((await assetRequest(work.originAssetId, member.cookie)).status).toBe(HTTP_STATUS.FORBIDDEN);

    // Unsaved user and Admin without membership: denied.
    for (const cookie of [unsaved.cookie, admin.cookie]) {
      expect((await partsRequest(work.workId, cookie)).status).toBe(HTTP_STATUS.NOT_FOUND);
      expect((await assetRequest(work.coverAssetId, cookie)).status).toBe(HTTP_STATUS.FORBIDDEN);
      expect((await assetRequest(work.imageAssetId, cookie)).status).toBe(HTTP_STATUS.FORBIDDEN);
    }

    // Admin with its own membership follows ordinary membership and is allowed.
    expect((await partsRequest(work.workId, memberAdmin.cookie)).status).toBe(200);
    expect((await assetRequest(work.coverAssetId, memberAdmin.cookie)).status).toBe(200);
    expect((await assetRequest(work.imageAssetId, memberAdmin.cookie)).status).toBe(200);
  });
});
