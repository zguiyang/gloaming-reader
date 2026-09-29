import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  user as userTable,
} from '@gloaming/db';
import { ASSIST_SSE_EVENT } from '@gloaming/shared/assist';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
import { audioKindForRole } from '@gloaming/shared/content-assets';
import { TRANSLATE_SSE_EVENT } from '@gloaming/shared/translate';

import app from '@/app';
import * as aiService from '@/domains/ai';
import { partAudioObjectKey } from '@/domains/assets/audio/keys';
import { hashPartAudioContent } from '@/domains/works/content';
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
const memory = createMemoryObjectStore();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) {
    return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
  }
  const single = response.headers.get('set-cookie');
  return single ? single.split(';')[0]! : '';
}

async function signUp(input: { email: string; username: string; name: string }) {
  return app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({
      email: input.email,
      password,
      name: input.name,
      username: input.username,
    }),
  });
}

async function markEmailVerified(email: string) {
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
}

async function setUserRole(email: string, role: string) {
  await db.update(userTable).set({ role }).where(eq(userTable.email, email));
}

async function signInEmail(email: string) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
}

async function createSession(role: 'user' | 'admin' = 'user') {
  const email = uniqueEmail(role);
  const username = `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  expect((await signUp({ email, username, name: role })).status).toBe(200);
  await markEmailVerified(email);
  if (role === 'admin') {
    await setUserRole(email, AUTH_ADMIN_ROLE);
  }
  const login = await signInEmail(email);
  expect(login.status).toBe(200);
  const [row] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  return { email, cookie: cookieHeader(login), userId: row!.id };
}

type SeededWork = {
  workId: string;
  partId: string;
  coverAssetId: string;
  audioAssetId: string;
  partBody: string;
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
  const audioAssetId = randomUUID();
  const partBody = '<p>Readable body for policy tests.</p>';
  const contentHash = hashPartAudioContent(partBody);
  const audioKind = audioKindForRole('us');
  const coverKey = `test/cover/${coverAssetId}.png`;
  const audioKey = partAudioObjectKey(partId, audioKind, contentHash);
  memory.store.set(coverKey, { body: Buffer.from('cover-png'), contentType: 'image/png' });
  memory.store.set(audioKey, { body: Buffer.from('audio-bytes'), contentType: 'audio/mpeg' });

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
    body: partBody,
  });
  await db.insert(contentAssetTable).values({
    id: coverAssetId,
    workId,
    partId: null,
    kind: 'cover',
    status: 'ready',
    mimeType: 'image/png',
    storageKey: coverKey,
    contentHash: 'test-cover-hash',
  });
  await db.insert(contentAssetTable).values({
    id: audioAssetId,
    workId,
    partId,
    kind: audioKind,
    status: 'ready',
    mimeType: 'audio/mpeg',
    storageKey: audioKey,
    contentHash,
    meta: {},
  });
  return { workId, partId, coverAssetId, audioAssetId, partBody };
}

async function* translateStream(): AsyncGenerator<aiService.AiStreamEvent> {
  yield { type: 'delta', text: 'TITLE\tChapter\n' };
  yield { type: 'delta', text: '0\t可读正文。\n' };
  yield {
    type: 'done',
    content: 'TITLE\tChapter\n0\t可读正文。\n',
    model: { rowId: 'm1', label: 'Test', modelId: 'gpt-test' },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
}

async function* assistStream(): AsyncGenerator<aiService.AiStreamEvent> {
  yield { type: 'delta', text: 'Readable' };
  yield {
    type: 'done',
    content: 'Readable context.',
    model: { rowId: 'm1', label: 'Test', modelId: 'gpt-test' },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
}

describe('Work read access policy', () => {
  const createdEmails: string[] = [];
  const createdWorkIds: string[] = [];

  beforeAll(() => {
    memory.store.clear();
    setObjectStoreForTests(memory);
  });

  afterAll(async () => {
    if (createdWorkIds.length > 0) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
    resetObjectStoreCache();
  });

  it('enforces owner, catalog, anonymous, and admin boundaries across user surfaces', async () => {
    const owner = await createSession('user');
    const other = await createSession('user');
    const admin = await createSession('admin');
    createdEmails.push(owner.email, other.email, admin.email);

    const ownerPrivate = await seedWork({
      title: 'Owner Private Work',
      ownerUserId: owner.userId,
      visibility: 'private',
      publishedAt: null,
    });
    const catalogPublished = await seedWork({
      title: 'Catalog Published Work',
      ownerUserId: null,
      visibility: 'catalog',
      publishedAt: new Date(),
    });
    const catalogDraft = await seedWork({
      title: 'Catalog Draft Work',
      ownerUserId: null,
      visibility: 'catalog',
      publishedAt: null,
    });
    createdWorkIds.push(ownerPrivate.workId, catalogPublished.workId, catalogDraft.workId);

    async function readerParts(workId: string, cookie?: string) {
      return app.request(`/api/reader/works/${workId}/parts`, cookie ? { headers: { Cookie: cookie } } : undefined);
    }

    expect((await readerParts(ownerPrivate.workId, owner.cookie)).status).toBe(200);
    expect((await readerParts(ownerPrivate.workId, other.cookie)).status).toBe(404);
    expect((await readerParts(ownerPrivate.workId)).status).toBe(404);
    expect((await readerParts(ownerPrivate.workId, admin.cookie)).status).toBe(200);

    expect((await readerParts(catalogPublished.workId)).status).toBe(200);
    expect((await readerParts(catalogPublished.workId, other.cookie)).status).toBe(200);
    expect((await readerParts(catalogDraft.workId)).status).toBe(404);
    expect((await readerParts(catalogDraft.workId, admin.cookie)).status).toBe(200);

    expect(
      (await app.request(`/api/catalog/works/${ownerPrivate.workId}`, { headers: { Cookie: owner.cookie } })).status,
    ).toBe(200);
    expect(
      (await app.request(`/api/catalog/works/${ownerPrivate.workId}`, { headers: { Cookie: other.cookie } })).status,
    ).toBe(404);
    expect((await app.request(`/api/catalog/works/${ownerPrivate.workId}`)).status).toBe(404);

    const ownerPartRes = await app.request(`/api/reader/parts/${ownerPrivate.partId}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(ownerPartRes.status).toBe(200);
    expect((await app.request(`/api/reader/parts/${ownerPrivate.partId}`)).status).toBe(404);
    expect(
      (await app.request(`/api/reader/parts/${ownerPrivate.partId}`, { headers: { Cookie: other.cookie } })).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/reader/parts/${ownerPrivate.partId}`, { headers: { Cookie: admin.cookie } })).status,
    ).toBe(200);

    const ownerAudio = await app.request(`/api/reader/parts/${ownerPrivate.partId}/audio?role=us`, {
      headers: { Cookie: owner.cookie },
    });
    expect(ownerAudio.status).toBe(200);
    expect((await app.request(`/api/reader/parts/${ownerPrivate.partId}/audio?role=us`)).status).toBe(404);
    expect(
      (
        await app.request(`/api/reader/parts/${ownerPrivate.partId}/audio?role=us`, {
          headers: { Cookie: other.cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/reader/parts/${ownerPrivate.partId}/audio?role=us`, {
          headers: { Cookie: admin.cookie },
        })
      ).status,
    ).toBe(200);

    const coverOwner = await app.request(`/api/assets/${ownerPrivate.coverAssetId}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(coverOwner.status).toBe(200);
    expect(await coverOwner.text()).toBe('cover-png');
    const coverCatalog = await app.request(`/api/assets/${catalogPublished.coverAssetId}`);
    expect(coverCatalog.status).toBe(200);
    expect(await coverCatalog.text()).toBe('cover-png');
    const coverDenied = await app.request(`/api/assets/${ownerPrivate.coverAssetId}`);
    expect(coverDenied.status).toBe(403);
    expect(
      (await app.request(`/api/assets/${ownerPrivate.coverAssetId}`, { headers: { Cookie: other.cookie } })).status,
    ).toBe(403);

    const originFileAssetId = randomUUID();
    const originFileKey = `test/origin/${originFileAssetId}.epub`;
    memory.store.set(originFileKey, { body: Buffer.from('owner-epub-bytes'), contentType: 'application/epub+zip' });
    await db.insert(contentAssetTable).values({
      id: originFileAssetId,
      workId: ownerPrivate.workId,
      partId: null,
      kind: 'origin_file',
      status: 'ready',
      mimeType: 'application/epub+zip',
      storageKey: originFileKey,
      contentHash: 'test-origin-hash',
    });
    const originOwner = await app.request(`/api/assets/${originFileAssetId}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(originOwner.status).toBe(200);
    expect(await originOwner.text()).toBe('owner-epub-bytes');
    expect(originOwner.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await app.request(`/api/assets/${originFileAssetId}`)).status).toBe(403);
    expect((await app.request(`/api/assets/${originFileAssetId}`, { headers: { Cookie: other.cookie } })).status).toBe(
      403,
    );
    const originAdmin = await app.request(`/api/assets/${originFileAssetId}`, {
      headers: { Cookie: admin.cookie },
    });
    expect(originAdmin.status).toBe(200);
    expect(await originAdmin.text()).toBe('owner-epub-bytes');

    const stateAnonymous = await app.request(`/api/reader/works/${ownerPrivate.workId}/state`);
    expect(stateAnonymous.status).toBe(HTTP_STATUS.UNAUTHORIZED);

    const stateOther = await app.request(`/api/reader/works/${ownerPrivate.workId}/state`, {
      headers: { Cookie: other.cookie },
    });
    expect(stateOther.status).toBe(404);

    const stateOwner = await app.request(`/api/reader/works/${ownerPrivate.workId}/state`, {
      headers: { Cookie: owner.cookie },
    });
    expect(stateOwner.status).toBe(200);

    const patchOther = await app.request(`/api/reader/works/${ownerPrivate.workId}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: other.cookie },
      body: JSON.stringify({ action: 'open' }),
    });
    expect(patchOther.status).toBe(404);

    const patchOwner = await app.request(`/api/reader/works/${ownerPrivate.workId}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify({ action: 'open' }),
    });
    expect(patchOwner.status).toBe(200);

    const patchAnonymous = await app.request(`/api/reader/works/${ownerPrivate.workId}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open' }),
    });
    expect(patchAnonymous.status).toBe(HTTP_STATUS.UNAUTHORIZED);

    expect((await app.request(`/api/catalog/works/${catalogPublished.workId}`)).status).toBe(200);
    expect(
      (await app.request(`/api/catalog/works/${catalogPublished.workId}`, { headers: { Cookie: other.cookie } }))
        .status,
    ).toBe(200);
    expect((await app.request(`/api/catalog/works/${catalogDraft.workId}`)).status).toBe(404);
    expect(
      (await app.request(`/api/catalog/works/${catalogDraft.workId}`, { headers: { Cookie: other.cookie } })).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/catalog/works/${catalogDraft.workId}`, { headers: { Cookie: admin.cookie } })).status,
    ).toBe(200);

    await db.insert(readingStateTable).values({
      id: randomUUID(),
      userId: other.userId,
      workId: catalogPublished.workId,
      currentPartId: catalogPublished.partId,
      completedThroughSortOrder: -1,
      status: 'in_progress',
      addedAt: new Date(),
      lastReadAt: new Date(),
      completedAt: null,
    });

    const historyBefore = await app.request('/api/reading-history', { headers: { Cookie: other.cookie } });
    const historyBeforeBody = (await historyBefore.json()) as { works: Array<{ workId: string }> };
    expect(historyBeforeBody.works.some((w) => w.workId === catalogPublished.workId)).toBe(true);

    await db
      .update(readingWorkTable)
      .set({ publishedAt: null })
      .where(eq(readingWorkTable.id, catalogPublished.workId));

    const historyAfter = await app.request('/api/reading-history', { headers: { Cookie: other.cookie } });
    const historyAfterBody = (await historyAfter.json()) as { works: Array<{ workId: string }> };
    expect(historyAfterBody.works.some((w) => w.workId === catalogPublished.workId)).toBe(false);

    const createConversation = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: other.cookie },
      body: JSON.stringify({
        surface: 'assist-read',
        subjectType: 'reading_work',
        subjectId: ownerPrivate.workId,
      }),
    });
    expect(createConversation.status).toBe(404);

    const translateDenied = await app.request('/api/translate/part', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: other.cookie },
      body: JSON.stringify({ partId: ownerPrivate.partId }),
    });
    expect(translateDenied.status).toBe(200);
    const translateText = await translateDenied.text();
    expect(translateText).toContain('error');

    const assistDenied = await app.request('/api/assist/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: other.cookie },
      body: JSON.stringify({
        actionId: 'meaning',
        workId: ownerPrivate.workId,
        partId: ownerPrivate.partId,
        selection: 'Readable',
      }),
    });
    expect(assistDenied.status).toBe(200);
    const assistText = await assistDenied.text();
    expect(assistText).toContain('error');

    const streamSpy = vi.spyOn(aiService, 'streamAi').mockImplementation(() => translateStream());
    const invokeSpy = vi.spyOn(aiService, 'invokeAi').mockResolvedValue({
      content: { suggestions: ['Follow-up one', 'Follow-up two', 'Follow-up three'] },
      model: { rowId: 'm1', label: 'Test', modelId: 'gpt-test' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    try {
      const translateOwner = await app.request('/api/translate/part', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Cookie: owner.cookie },
        body: JSON.stringify({ partId: ownerPrivate.partId }),
      });
      expect(translateOwner.status).toBe(200);
      expect((await translateOwner.text()).includes(TRANSLATE_SSE_EVENT.title)).toBe(true);
      streamSpy.mockImplementation(() => assistStream());
      const assistOwner = await app.request('/api/assist/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Cookie: owner.cookie },
        body: JSON.stringify({
          actionId: 'meaning',
          workId: ownerPrivate.workId,
          partId: ownerPrivate.partId,
          selection: 'Readable',
        }),
      });
      expect(assistOwner.status).toBe(200);
      expect((await assistOwner.text()).includes(ASSIST_SSE_EVENT.done)).toBe(true);
    } finally {
      streamSpy.mockRestore();
      invokeSpy.mockRestore();
    }
  });
});
