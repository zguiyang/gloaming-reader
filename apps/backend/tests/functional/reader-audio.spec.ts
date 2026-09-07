import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  ttsConfig as ttsConfigTable,
  user as userTable,
} from '@gloaming/db';
import type { ReaderAudioTrack, ReaderPartData } from '@gloaming/shared';
import type { AdminWork } from '@gloaming/shared';
import { audioKindForRole } from '@gloaming/shared';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/db';
import { processPartAudioGenerate } from '@/jobs/part-audio-generate';
import * as audioConcat from '@/lib/audio-concat';
import { encryptApiKey } from '@/lib/llm';
import * as queueLib from '@/lib/queue';
import * as redisLib from '@/lib/redis';
import * as azureTts from '@/lib/tts/azure';
import { partAudioObjectKey, partAudioSegmentKey } from '@/modules/content-assets/service';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/modules/oss';
import { TTS_CONFIG_ID } from '@/modules/tts/service';
import { hashPartAudioContent } from '@/modules/works/content-hash';

import { createMemoryObjectStore } from '../helpers/memory-oss';

const password = 'password123';

type TtsConfigRow = typeof ttsConfigTable.$inferSelect;

let priorConfig: TtsConfigRow | null | undefined;

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
  return { email, cookie: cookieHeader(login) };
}

function createMemoryRedis() {
  const store = new Map<string, string>();
  return {
    store,
    client: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
    },
  };
}

async function restorePriorConfig(): Promise<void> {
  if (priorConfig === undefined) {
    return;
  }
  await db.delete(ttsConfigTable).where(eq(ttsConfigTable.id, TTS_CONFIG_ID));
  if (priorConfig) {
    await db.insert(ttsConfigTable).values(priorConfig);
  }
}

async function ensureTtsConfig(): Promise<void> {
  await db
    .insert(ttsConfigTable)
    .values({
      id: TTS_CONFIG_ID,
      provider: 'azure',
      region: 'eastasia',
      apiKeyCiphertext: encryptApiKey('learn-audio-test-key'),
      isEnabled: true,
      defaultVoice: 'en-US-JennyNeural',
      usVoice: 'en-US-GuyNeural',
      ukVoice: 'en-GB-SoniaNeural',
    })
    .onConflictDoUpdate({
      target: ttsConfigTable.id,
      set: {
        region: 'eastasia',
        apiKeyCiphertext: encryptApiKey('learn-audio-test-key'),
        isEnabled: true,
        defaultVoice: 'en-US-JennyNeural',
        usVoice: 'en-US-GuyNeural',
        ukVoice: 'en-GB-SoniaNeural',
      },
    });
}

beforeAll(async () => {
  const rows = await db.select().from(ttsConfigTable).where(eq(ttsConfigTable.id, TTS_CONFIG_ID)).limit(1);
  priorConfig = rows[0] ?? null;
});

afterAll(async () => {
  await restorePriorConfig();
  resetObjectStoreCache();
});

describe('learner part audio', () => {
  it('exposes DB-derived availability; missing chapter fails on asset GetObject only', async () => {
    const admin = await createSession('admin');
    const learner = await createSession('user');
    await ensureTtsConfig();

    const create = await app.request('/api/admin/works', {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Listen Title',
        body: 'Listen body here.',
      }),
    });
    expect(create.status).toBe(201);
    const work = (await create.json()) as AdminWork;
    const partId = work.parts[0]!.id;

    expect(
      (
        await app.request(`/api/admin/works/${work.id}`, {
          method: 'PATCH',
          headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sources: ['demo'], tags: ['daily'] }),
        })
      ).status,
    ).toBe(200);

    const memoryRedis = createMemoryRedis();
    const objectStore = createMemoryObjectStore();
    const audioJobs: Parameters<typeof processPartAudioGenerate>[0][] = [];
    const audioJobIds: string[] = [];
    let ttsCallCount = 0;
    setObjectStoreForTests(objectStore);
    const redisSpy = vi.spyOn(redisLib, 'getRedis').mockReturnValue(memoryRedis.client as never);
    vi.spyOn(azureTts, 'synthesizeAzureTts').mockImplementation(async (input) => {
      ttsCallCount += 1;
      expect(input.text).toBe('Listen body here.');
      expect(input.text).not.toContain('Listen Title');
      return {
        audio: Buffer.from(`mp3-${input.voice}`),
        mimeType: 'audio/mpeg',
        wordTimings: [{ text: 'Listen', audioOffsetMs: 0, durationMs: 100, textOffset: 0 }],
      };
    });
    vi.spyOn(audioConcat, 'concatMp3Buffers').mockImplementation(async (parts) => Buffer.concat(parts));
    const queueSpy = vi.spyOn(queueLib, 'enqueue').mockImplementation(async (name, data, options) => {
      if (name === 'part-audio-generate') {
        const job = data as Parameters<typeof processPartAudioGenerate>[0];
        audioJobs.push(job);
        audioJobIds.push((options as { jobId?: string } | undefined)?.jobId ?? '');
        await processPartAudioGenerate(job);
      }
      return `job-${Date.now()}`;
    });

    const draftAudio = await app.request(`/api/reader/parts/${partId}/audio?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(draftAudio.status).toBe(404);

    expect(
      (
        await app.request(`/api/admin/works/${work.id}/publish`, {
          method: 'POST',
          headers: { Cookie: admin.cookie },
        })
      ).status,
    ).toBe(200);

    async function partAudioAvail(): Promise<ReaderPartData['audioAvailable']> {
      const res = await app.request(`/api/reader/parts/${partId}`, {
        headers: { Cookie: learner.cookie },
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as ReaderPartData).audioAvailable;
    }

    expect(await partAudioAvail()).toEqual({ us: false, uk: false });

    const initialGeneration = await app.request(`/api/admin/parts/${partId}/audio/generate`, {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(initialGeneration.status).toBe(200);
    expect(await initialGeneration.json()).toMatchObject({
      enqueued: [
        { partId, role: 'us' },
        { partId, role: 'uk' },
      ],
      skipped: [],
    });

    expect(await partAudioAvail()).toEqual({ us: true, uk: true });
    expect(ttsCallCount).toBe(2);
    expect(audioJobs).toHaveLength(2);
    expect(audioJobIds.every((jobId) => jobId.startsWith('part-audio-generate:'))).toBe(true);
    expect(audioJobs.map(({ role }) => role)).toEqual(['us', 'uk']);
    expect(audioJobs.every(({ generationKey, generationToken }) => generationKey && generationToken)).toBe(true);

    expect(
      (
        await app.request(`/api/admin/parts/${partId}/audio/generate`, {
          method: 'POST',
          headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(200);
    expect(ttsCallCount).toBe(2);
    expect(audioJobs).toHaveLength(2);

    const usKind = audioKindForRole('us');
    const [usBeforeEnqueueFailure] = await db
      .select()
      .from(contentAssetTable)
      .where(and(eq(contentAssetTable.partId, partId), eq(contentAssetTable.kind, usKind)))
      .limit(1);
    expect(usBeforeEnqueueFailure?.status).toBe('ready');
    const originalUsKeys = usBeforeEnqueueFailure?.meta.objectKeys ?? [];
    queueSpy.mockRejectedValueOnce(new Error('queue unavailable'));
    const enqueueFailure = await app.request(`/api/admin/parts/${partId}/audio/generate`, {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true, roles: ['us'] }),
    });
    expect(enqueueFailure.status).toBe(500);
    const [usAfterEnqueueFailure] = await db
      .select()
      .from(contentAssetTable)
      .where(and(eq(contentAssetTable.partId, partId), eq(contentAssetTable.kind, usKind)))
      .limit(1);
    expect(usAfterEnqueueFailure?.status).toBe('ready');
    expect(usAfterEnqueueFailure?.meta.objectKeys).toEqual(originalUsKeys);
    queueSpy.mockImplementation(async (name, data, options) => {
      if (name === 'part-audio-generate') {
        const job = data as Parameters<typeof processPartAudioGenerate>[0];
        audioJobs.push(job);
        audioJobIds.push((options as { jobId?: string } | undefined)?.jobId ?? '');
        await processPartAudioGenerate(job);
      }
      return `job-${Date.now()}`;
    });

    await db
      .update(contentAssetTable)
      .set({
        status: 'generating',
        generationKey: usBeforeEnqueueFailure!.generationKey,
        generationToken: 'active-owner',
        generationLeaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(and(eq(contentAssetTable.partId, partId), eq(contentAssetTable.kind, usKind)));
    const forceWhileActive = await app.request(`/api/admin/parts/${partId}/audio/generate`, {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true, roles: ['us'] }),
    });
    expect(forceWhileActive.status).toBe(200);
    expect(await forceWhileActive.json()).toMatchObject({
      enqueued: [],
      skipped: [{ partId, role: 'us', reason: 'fresh' }],
    });
    expect(ttsCallCount).toBe(2);

    await db.update(readingPartTable).set({ body: 'Listen body changed.' }).where(eq(readingPartTable.id, partId));
    const forceWhileDifferentHashActive = await app.request(`/api/admin/parts/${partId}/audio/generate`, {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true, roles: ['us'] }),
    });
    expect(forceWhileDifferentHashActive.status).toBe(200);
    expect(ttsCallCount).toBe(2);
    expect(audioJobs).toHaveLength(2);
    expect(await forceWhileDifferentHashActive.json()).toMatchObject({
      enqueued: [],
      skipped: [{ partId, role: 'us', reason: 'fresh' }],
    });
    const [activeUsAfterForces] = await db
      .select()
      .from(contentAssetTable)
      .where(and(eq(contentAssetTable.partId, partId), eq(contentAssetTable.kind, usKind)))
      .limit(1);
    expect(activeUsAfterForces).toMatchObject({
      status: 'generating',
      generationKey: usBeforeEnqueueFailure!.generationKey,
      generationToken: 'active-owner',
    });
    await db.update(readingPartTable).set({ body: 'Listen body here.' }).where(eq(readingPartTable.id, partId));

    await db
      .update(contentAssetTable)
      .set({ status: 'ready', generationToken: null, generationLeaseExpiresAt: null })
      .where(and(eq(contentAssetTable.partId, partId), eq(contentAssetTable.kind, usKind)));

    const staleJob = audioJobs[0]!;
    const forcedRegeneration = await app.request(`/api/admin/parts/${partId}/audio/generate`, {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    expect(forcedRegeneration.status).toBe(200);
    expect(await forcedRegeneration.json()).toMatchObject({
      enqueued: [
        { partId, role: 'us' },
        { partId, role: 'uk' },
      ],
      skipped: [],
    });
    const regeneratedAssets = await db
      .select({
        role: contentAssetTable.kind,
        status: contentAssetTable.status,
        generationToken: contentAssetTable.generationToken,
      })
      .from(contentAssetTable)
      .where(
        and(eq(contentAssetTable.partId, partId), inArray(contentAssetTable.kind, [usKind, audioKindForRole('uk')])),
      );
    expect(regeneratedAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: usKind, status: 'ready', generationToken: null }),
        expect.objectContaining({ role: audioKindForRole('uk'), status: 'ready', generationToken: null }),
      ]),
    );
    expect(ttsCallCount).toBe(4);
    expect(audioJobs).toHaveLength(4);
    expect(audioJobIds[0]).not.toBe(audioJobIds[2]);
    expect(audioJobs.slice(2).map(({ role }) => role)).toEqual(['us', 'uk']);
    expect(audioJobs.slice(2).every(({ generationKey, generationToken }) => generationKey && generationToken)).toBe(
      true,
    );

    await processPartAudioGenerate(staleJob);
    expect(ttsCallCount).toBe(4);

    const usTrack = await app.request(`/api/reader/parts/${partId}/audio?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(usTrack.status).toBe(200);
    const usBody = (await usTrack.json()) as ReaderAudioTrack;
    expect(usBody.role).toBe('us');
    expect(usBody.voice).toBe('en-US-GuyNeural');
    expect(usBody.audioUrl).toMatch(/^\/api\/assets\//);
    expect(usBody.assetId).toBeTruthy();
    expect(usBody.wordTimings.length).toBeGreaterThan(0);
    expect(usBody.wordTimings[0]).toMatchObject({
      text: 'Listen',
      audioOffsetMs: 0,
      durationMs: 100,
      textOffset: 0,
    });

    const contentHash = hashPartAudioContent('Listen body here.');

    // Segments are not required for playback — only storageKey (chapter) is streamed.
    objectStore.store.delete(partAudioSegmentKey(partId, audioKindForRole('us'), contentHash, 0));
    expect(await partAudioAvail()).toEqual({ us: true, uk: true });
    expect((await app.request(`/api/assets/${usBody.assetId}`, { headers: { Cookie: learner.cookie } })).status).toBe(
      200,
    );

    const ukChapterKey = partAudioObjectKey(partId, audioKindForRole('uk'), contentHash);
    objectStore.store.delete(ukChapterKey);

    // P3: missing chapter does not affect DB-derived availability / track metadata.
    const ukTrackAfterDelete = await app.request(`/api/reader/parts/${partId}/audio?role=uk`, {
      headers: { Cookie: learner.cookie },
    });
    expect(ukTrackAfterDelete.status).toBe(200);
    const ukTrackBody = (await ukTrackAfterDelete.json()) as ReaderAudioTrack;
    expect(ukTrackBody.assetId).toBeTruthy();

    expect(await partAudioAvail()).toEqual({ us: true, uk: true });

    expect(
      (await app.request(`/api/assets/${ukTrackBody.assetId}`, { headers: { Cookie: learner.cookie } })).status,
    ).toBe(404);

    // us chapter still present — independent of uk object loss
    const usStillOk = await app.request(`/api/reader/parts/${partId}/audio?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(usStillOk.status).toBe(200);
    const usStillBody = (await usStillOk.json()) as ReaderAudioTrack;
    expect(
      (await app.request(`/api/assets/${usStillBody.assetId}`, { headers: { Cookie: learner.cookie } })).status,
    ).toBe(200);

    // Parts are read-only now — simulate content change directly in the DB
    // to verify audio invalidation (hash is based on extracted plain text).
    await db.update(readingPartTable).set({ body: 'Listen body changed.' }).where(eq(readingPartTable.id, partId));

    expect(await partAudioAvail()).toEqual({ us: false, uk: false });

    const staleTrack = await app.request(`/api/reader/parts/${partId}/audio?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(staleTrack.status).toBe(404);

    await db.delete(readingWorkTable).where(eq(readingWorkTable.id, work.id));
    redisSpy.mockRestore();
    vi.restoreAllMocks();
    resetObjectStoreCache();
  });
});
