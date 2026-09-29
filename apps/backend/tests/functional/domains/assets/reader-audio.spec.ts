import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  user as userTable,
} from '@gloaming/db';
import { audioKindForRole } from '@gloaming/shared/content-assets';
import type { ReaderAudioTrack, ReaderPartData } from '@gloaming/shared/reader';

import app from '@/app';
import { partAudioObjectKey } from '@/domains/assets/audio/keys';
import { hashPartAudioContent } from '@/domains/works/content';
import { db } from '@/infra/db';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/infra/storage';

import { createCatalogWorkFixture } from '../../../helpers/catalog-work-fixture';
import { createMemoryObjectStore } from '../../../helpers/memory-oss';

const password = 'password123';

function uniqueEmail() {
  return `reader-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function createSession() {
  const email = uniqueEmail();
  const username = `reader_audio_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const signup = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password, name: 'reader audio', username }),
  });
  expect(signup.status).toBe(200);
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
  const login = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  return { email, cookie: cookieHeader(login) };
}

describe('Reader audio runtime', () => {
  const createdEmails: string[] = [];
  const createdWorkIds: string[] = [];

  afterAll(async () => {
    if (createdWorkIds.length) await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    for (const email of createdEmails) await db.delete(userTable).where(eq(userTable.email, email));
    resetObjectStoreCache();
  });

  it('serves existing audio, reports object loss on GetObject, and hides content-stale tracks', async () => {
    const learner = await createSession();
    createdEmails.push(learner.email);
    const body = 'Listen body here.';
    const work = await createCatalogWorkFixture({ title: 'Listen Title', body });
    createdWorkIds.push(work.id);
    const part = work.parts[0]!;
    const objectStore = createMemoryObjectStore();
    setObjectStoreForTests(objectStore);

    for (const role of ['us', 'uk'] as const) {
      const kind = audioKindForRole(role);
      const contentHash = hashPartAudioContent(body);
      const storageKey = partAudioObjectKey(part.id, kind, contentHash);
      objectStore.store.set(storageKey, { body: Buffer.from(`mp3-${role}`), contentType: 'audio/mpeg' });
      await db.insert(contentAssetTable).values({
        id: randomUUID(),
        workId: work.id,
        partId: part.id,
        kind,
        status: 'ready',
        contentHash,
        storageKey,
        mimeType: 'audio/mpeg',
        meta: {},
      });
    }

    const partResponse = await app.request(`/api/reader/parts/${part.id}`, { headers: { Cookie: learner.cookie } });
    expect(partResponse.status).toBe(200);
    expect(((await partResponse.json()) as ReaderPartData).audioAvailable).toEqual({ us: true, uk: true });

    const usResponse = await app.request(`/api/reader/parts/${part.id}/audio?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(usResponse.status).toBe(200);
    const usTrack = (await usResponse.json()) as ReaderAudioTrack;
    expect(usTrack).toMatchObject({ role: 'us', mimeType: 'audio/mpeg', audioUrl: `/api/assets/${usTrack.assetId}` });
    expect((await app.request(usTrack.audioUrl, { headers: { Cookie: learner.cookie } })).status).toBe(200);

    const ukResponse = await app.request(`/api/reader/parts/${part.id}/audio?role=uk`, {
      headers: { Cookie: learner.cookie },
    });
    expect(ukResponse.status).toBe(200);
    const ukTrack = (await ukResponse.json()) as ReaderAudioTrack;
    objectStore.store.delete(partAudioObjectKey(part.id, audioKindForRole('uk'), hashPartAudioContent(body)));
    expect((await app.request(ukTrack.audioUrl, { headers: { Cookie: learner.cookie } })).status).toBe(404);
    expect(
      (
        (await (
          await app.request(`/api/reader/parts/${part.id}`, { headers: { Cookie: learner.cookie } })
        ).json()) as ReaderPartData
      ).audioAvailable,
    ).toEqual({ us: true, uk: true });

    await db.update(readingPartTable).set({ body: 'Updated reading text.' }).where(eq(readingPartTable.id, part.id));
    expect(
      (
        (await (
          await app.request(`/api/reader/parts/${part.id}`, { headers: { Cookie: learner.cookie } })
        ).json()) as ReaderPartData
      ).audioAvailable,
    ).toEqual({ us: false, uk: false });
    expect(
      (await app.request(`/api/reader/parts/${part.id}/audio?role=us`, { headers: { Cookie: learner.cookie } })).status,
    ).toBe(404);
  });

  it('keeps parts readable when no audio exists and returns unavailable audio', async () => {
    const learner = await createSession();
    createdEmails.push(learner.email);
    const work = await createCatalogWorkFixture({ title: 'No Audio', body: '<p>Text without audio.</p>' });
    createdWorkIds.push(work.id);
    const partId = work.parts[0]!.id;

    const response = await app.request(`/api/reader/parts/${partId}`, { headers: { Cookie: learner.cookie } });
    expect(response.status).toBe(200);
    expect(((await response.json()) as ReaderPartData).audioAvailable).toEqual({ us: false, uk: false });
    expect(
      (await app.request(`/api/reader/parts/${partId}/audio?role=us`, { headers: { Cookie: learner.cookie } })).status,
    ).toBe(404);
  });
});
