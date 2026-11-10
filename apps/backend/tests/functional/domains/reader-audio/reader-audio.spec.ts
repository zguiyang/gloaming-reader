import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  partAudioSegment as partAudioSegmentTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  ttsConfig as ttsConfigTable,
  ttsInvocationLog as ttsInvocationLogTable,
  user as userTable,
} from '@gloaming/db';
import type { ReaderAudioManifest, ReaderAudioSegment } from '@gloaming/shared/reader';

import app from '@/app';
import { buildReaderAudioIdentity, type ReaderAudioIdentity } from '@/domains/reader-audio/identity';
import { SEGMENT_LEASE_MS, WAIT_TIMEOUT_MS, waitForSegmentReady } from '@/domains/reader-audio/repository';
import { deriveReaderAudioSegments, type ReaderAudioDerivedSegment } from '@/domains/reader-audio/segmenter';
import { deriveReaderAudioSegmentsForPart, resetReaderAudioDeriveCache } from '@/domains/reader-audio/service';
import { db } from '@/infra/db';
import { encryptApiKey } from '@/infra/llm';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/infra/storage';
import { synthesizeAzureTts } from '@/infra/tts';
import { AppError } from '@/shared/errors/app-error';

import { createCatalogWorkFixture } from '../../../helpers/catalog-work-fixture';
import { createMemoryObjectStore } from '../../../helpers/memory-oss';

vi.mock('@/infra/tts', () => ({
  synthesizeAzureTts: vi.fn(),
}));

const password = 'password123';

const FAKE_MP3 = Buffer.from('FAKE_MP3_BYTES_FOR_READER_AUDIO');

const azureTimings = [{ text: 'Listen', audioOffsetMs: 0, durationMs: 120, textOffset: 0 }];

function okSynthesis() {
  return {
    audio: Buffer.from(FAKE_MP3),
    mimeType: 'audio/mpeg',
    wordTimings: azureTimings.map((t) => ({ ...t })),
  };
}

const instanceTtsValues = {
  ownerUserId: null,
  provider: 'azure',
  region: 'eastus',
  apiKeyCiphertext: encryptApiKey('reader-audio-fake-key'),
  isEnabled: true,
  defaultVoice: 'en-US-JennyNeural',
  usVoice: 'en-US-JennyNeural',
  ukVoice: 'en-GB-SoniaNeural',
};

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function createSession(prefix = 'reader') {
  const email = uniqueEmail(prefix);
  const username = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const signup = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password, name: prefix, username }),
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

async function userIdByEmail(email: string): Promise<string> {
  const [row] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  return row!.id;
}

async function insertInstanceConfig(): Promise<string> {
  const [row] = await db
    .insert(ttsConfigTable)
    .values({ id: randomUUID(), ...instanceTtsValues })
    .returning({ id: ttsConfigTable.id });
  return row!.id;
}

async function createPersonalWork(ownerUserId: string, body: string) {
  const workId = randomUUID();
  const partId = randomUUID();
  await db.insert(readingWorkTable).values({
    id: workId,
    title: `Reader audio private ${workId.slice(0, 6)}`,
    author: '',
    description: '',
    language: 'en',
    processingStatus: 'ready',
    ownerUserId,
    visibility: 'private',
    publishedAt: null,
  });
  await db.insert(readingPartTable).values({
    id: partId,
    workId,
    sortOrder: 0,
    kind: 'chapter',
    title: 'Private chapter',
    body,
    meta: {},
  });
  return { workId, partId };
}

const TWO_PARAGRAPHS = '<p>Listen to the first paragraph slowly.</p><p>Then hear the second one clearly.</p>';

describe('Reader lazy audio runtime', () => {
  const createdEmails: string[] = [];
  const createdWorkIds: string[] = [];
  const createdPartIds: string[] = [];
  const createdUserTtsIds: string[] = [];
  let priorInstanceConfig: typeof ttsConfigTable.$inferSelect | null = null;
  let instanceConfigId: string;

  beforeAll(async () => {
    const rows = await db.select().from(ttsConfigTable).where(isNull(ttsConfigTable.ownerUserId)).limit(1);
    priorInstanceConfig = rows[0] ?? null;
    await db.delete(ttsConfigTable).where(isNull(ttsConfigTable.ownerUserId));
    instanceConfigId = await insertInstanceConfig();
  });

  afterAll(async () => {
    await db.delete(ttsConfigTable).where(eq(ttsConfigTable.id, instanceConfigId));
    if (priorInstanceConfig) {
      await db.insert(ttsConfigTable).values(priorInstanceConfig);
    }
    if (createdPartIds.length) {
      await db.delete(ttsInvocationLogTable).where(inArray(ttsInvocationLogTable.partId, createdPartIds));
    }
    if (createdUserTtsIds.length) {
      await db.delete(ttsConfigTable).where(inArray(ttsConfigTable.id, createdUserTtsIds));
    }
    if (createdWorkIds.length) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
    resetObjectStoreCache();
  });

  beforeEach(() => {
    vi.mocked(synthesizeAzureTts).mockReset();
    vi.mocked(synthesizeAzureTts).mockImplementation(async () => okSynthesis());
    setObjectStoreForTests(createMemoryObjectStore());
  });

  async function createCatalogPart(body: string) {
    const work = await createCatalogWorkFixture({ title: `Lazy audio ${Date.now()}`, body });
    createdWorkIds.push(work.id);
    const part = work.parts[0]!;
    createdPartIds.push(part.id);
    return part;
  }

  /** Instance-scope identity + derived segment for a test part (mirrors `buildIdentity` in service). */
  function instanceIdentityFor(partId: string, role: 'us' | 'uk', index = 0) {
    const derived = deriveReaderAudioSegments(TWO_PARAGRAPHS)[index]!;
    const identity = buildReaderAudioIdentity({
      partId,
      role,
      scopeKey: 'instance',
      ownerUserId: null,
      provider: instanceTtsValues.provider,
      region: instanceTtsValues.region,
      voice: role === 'us' ? instanceTtsValues.usVoice : instanceTtsValues.ukVoice,
      segmentHash: derived.segmentHash,
    });
    return { identity, derived };
  }

  /** Insert a `part_audio_segment` row directly (constructed lease rows for wait/takeover tests). */
  async function insertLeaseRow(
    partId: string,
    role: 'us' | 'uk',
    identity: ReaderAudioIdentity,
    derived: ReaderAudioDerivedSegment,
    overrides: Partial<typeof partAudioSegmentTable.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(partAudioSegmentTable)
      .values({
        id: randomUUID(),
        partId,
        role,
        scopeKey: 'instance',
        ownerUserId: null,
        configFingerprint: identity.configFingerprint,
        segmentIndex: derived.index,
        segmentKey: derived.key,
        segmentHash: derived.segmentHash,
        paragraphAnchor: derived.paragraphAnchor,
        paragraphTextOffset: derived.paragraphTextOffset,
        textLength: derived.textLength,
        voice: role === 'us' ? instanceTtsValues.usVoice : instanceTtsValues.ukVoice,
        mimeType: 'audio/mpeg',
        storageKey: identity.storageKey,
        ...overrides,
      })
      .returning();
    return row!;
  }

  it('reports ttsConfigured=false and serves no segments when no configuration exists', async () => {
    const learner = await createSession('lazy0');
    createdEmails.push(learner.email);
    const part = await createCatalogPart(TWO_PARAGRAPHS);

    await db.delete(ttsConfigTable).where(isNull(ttsConfigTable.ownerUserId));
    try {
      const manifestRes = await app.request(`/api/reader/parts/${part.id}/audio/manifest?role=us`, {
        headers: { Cookie: learner.cookie },
      });
      expect(manifestRes.status).toBe(200);
      const manifest = (await manifestRes.json()) as ReaderAudioManifest;
      expect(manifest).toEqual({ role: 'us', ttsConfigured: false, configFingerprint: null, segments: [] });

      const segmentRes = await app.request(`/api/reader/parts/${part.id}/audio/segments/0?role=us`, {
        headers: { Cookie: learner.cookie },
      });
      expect(segmentRes.status).toBe(503);
      expect(((await segmentRes.json()) as { code: string }).code).toBe('api.errors.tts.notConfigured');
      expect(synthesizeAzureTts).not.toHaveBeenCalled();
    } finally {
      instanceConfigId = await insertInstanceConfig();
    }
  });

  it('serves a manifest without synthesizing, then synthesizes once on miss and serves the ready row', async () => {
    const learner = await createSession('lazy1');
    createdEmails.push(learner.email);
    const part = await createCatalogPart(TWO_PARAGRAPHS);

    const manifestRes = await app.request(`/api/reader/parts/${part.id}/audio/manifest?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(manifestRes.status).toBe(200);
    const manifest = (await manifestRes.json()) as ReaderAudioManifest;
    expect(manifest.ttsConfigured).toBe(true);
    expect(manifest.configFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(manifest.segments).toHaveLength(2);
    expect(manifest.segments[0]).toMatchObject({
      index: 0,
      key: 'p0:c0',
      paragraphAnchor: '0',
      paragraphTextOffset: 0,
    });
    expect(manifest.segments[1]).toMatchObject({ index: 1, paragraphAnchor: '1' });
    for (const segment of manifest.segments) {
      expect(segment.segmentHash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Manifest derivation never triggers synthesis.
    expect(synthesizeAzureTts).not.toHaveBeenCalled();

    // Miss → synthesize → ready.
    const first = await app.request(
      `/api/reader/parts/${part.id}/audio/segments/0?role=us&expectedHash=${manifest.segments[0]!.segmentHash}`,
      { headers: { Cookie: learner.cookie } },
    );
    expect(first.status).toBe(200);
    const segment = (await first.json()) as ReaderAudioSegment;
    expect(synthesizeAzureTts).toHaveBeenCalledTimes(1);
    expect(synthesizeAzureTts).toHaveBeenCalledWith(
      expect.objectContaining({ voice: 'en-US-JennyNeural', region: 'eastus', text: expect.any(String) }),
    );
    expect(segment).toMatchObject({
      index: 0,
      role: 'us',
      voice: 'en-US-JennyNeural',
      mimeType: 'audio/mpeg',
      durationMs: 120,
      paragraphAnchor: '0',
      segmentHash: manifest.segments[0]!.segmentHash,
      audioUrl: `/api/reader/parts/${part.id}/audio/segments/0/audio?v=2&role=us&hash=${segment.segmentHash}`,
    });
    expect(segment.wordTimings).toEqual([{ text: 'Listen', audioOffsetMs: 0, durationMs: 120, textOffset: 0 }]);

    const rows = await db.select().from(partAudioSegmentTable).where(eq(partAudioSegmentTable.partId, part.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'ready',
      scopeKey: 'instance',
      ownerUserId: null,
      segmentHash: manifest.segments[0]!.segmentHash,
    });
    expect(rows[0]!.generationToken).toBeNull();
    expect(rows[0]!.storageKey).toContain('reader-audio/instance/');

    // Ready hit — no second Azure call.
    const second = await app.request(`/api/reader/parts/${part.id}/audio/segments/0?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(second.status).toBe(200);
    const secondSegment = (await second.json()) as ReaderAudioSegment;
    expect(secondSegment.audioUrl).toBe(segment.audioUrl);
    expect(synthesizeAzureTts).toHaveBeenCalledTimes(1);

    // The streamed audio is byte-identical to what the mock synthesized.
    const audioRes = await app.request(segment.audioUrl, { headers: { Cookie: learner.cookie } });
    expect(audioRes.status).toBe(200);
    expect(Buffer.from(await audioRes.arrayBuffer()).toString()).toBe(FAKE_MP3.toString());
    expect(audioRes.headers.get('accept-ranges')).toBe('bytes');
    // Voice and provider scope can change independently of the text hash.
    expect(audioRes.headers.get('cache-control')).toBe('private, no-store');
  });

  it('rejects a stale manifest hash with 409 and an out-of-range index with 404', async () => {
    const learner = await createSession('lazy2');
    createdEmails.push(learner.email);
    const part = await createCatalogPart(TWO_PARAGRAPHS);

    const stale = await app.request(
      `/api/reader/parts/${part.id}/audio/segments/0?role=us&expectedHash=${'f'.repeat(64)}`,
      { headers: { Cookie: learner.cookie } },
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe('api.errors.readerAudio.manifestStale');

    const outOfRange = await app.request(`/api/reader/parts/${part.id}/audio/segments/99?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(outOfRange.status).toBe(404);
    expect(synthesizeAzureTts).not.toHaveBeenCalled();
  });

  it('never registers the retired whole-chapter audio endpoint', async () => {
    const learner = await createSession('lazylegacy');
    createdEmails.push(learner.email);
    const part = await createCatalogPart(TWO_PARAGRAPHS);

    const legacy = await app.request(`/api/reader/parts/${part.id}/audio`, {
      headers: { Cookie: learner.cookie },
    });
    expect(legacy.status).toBe(404);
    expect(synthesizeAzureTts).not.toHaveBeenCalled();
  });

  it('synthesizes a contested segment exactly once and serves both requesters the same asset', async () => {
    const learner = await createSession('lazy3');
    createdEmails.push(learner.email);
    const part = await createCatalogPart(TWO_PARAGRAPHS);

    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(synthesizeAzureTts).mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 60));
      inFlight -= 1;
      return okSynthesis();
    });

    const [a, b] = await Promise.all([
      app.request(`/api/reader/parts/${part.id}/audio/segments/1?role=uk`, { headers: { Cookie: learner.cookie } }),
      app.request(`/api/reader/parts/${part.id}/audio/segments/1?role=uk`, { headers: { Cookie: learner.cookie } }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const segmentA = (await a.json()) as ReaderAudioSegment;
    const segmentB = (await b.json()) as ReaderAudioSegment;
    expect(synthesizeAzureTts).toHaveBeenCalledTimes(1);
    expect(maxInFlight).toBe(1);
    expect(segmentA.audioUrl).toBe(segmentB.audioUrl);
    expect(segmentA.voice).toBe('en-GB-SoniaNeural');

    const rows = await db.select().from(partAudioSegmentTable).where(eq(partAudioSegmentTable.partId, part.id));
    expect(rows.filter((row) => row.status === 'ready')).toHaveLength(1);
  });

  it('marks a failed synthesis and lets a later request take the lease over', async () => {
    const learner = await createSession('lazy4');
    createdEmails.push(learner.email);
    const part = await createCatalogPart(TWO_PARAGRAPHS);

    vi.mocked(synthesizeAzureTts).mockRejectedValueOnce(new AppError(503, 'api.errors.tts.synthesisFailed'));

    const failed = await app.request(`/api/reader/parts/${part.id}/audio/segments/0?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(failed.status).toBe(503);
    const [failedRow] = await db
      .select()
      .from(partAudioSegmentTable)
      .where(eq(partAudioSegmentTable.partId, part.id))
      .limit(1);
    expect(failedRow).toMatchObject({ status: 'failed', errorCode: 'api.errors.tts.synthesisFailed' });
    expect(failedRow!.generationToken).toBeNull();

    // Retry takes the failed row over and completes.
    const retried = await app.request(`/api/reader/parts/${part.id}/audio/segments/0?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(retried.status).toBe(200);
    expect(synthesizeAzureTts).toHaveBeenCalledTimes(2);
    const [recovered] = await db
      .select()
      .from(partAudioSegmentTable)
      .where(eq(partAudioSegmentTable.partId, part.id))
      .limit(1);
    expect(recovered).toMatchObject({ status: 'ready', errorCode: null });
  });

  it('keeps BYOK segments owner-scoped for the audio stream', async () => {
    const owner = await createSession('lazyown');
    const stranger = await createSession('lazystr');
    const secondStranger = await createSession('lazystr2');
    createdEmails.push(owner.email, stranger.email, secondStranger.email);
    const ownerUserId = await userIdByEmail(owner.email);
    const [userTts] = await db
      .insert(ttsConfigTable)
      .values({
        id: randomUUID(),
        ...instanceTtsValues,
        ownerUserId,
        apiKeyCiphertext: encryptApiKey('owner-byok-key'),
        usVoice: 'en-US-AriaNeural',
      })
      .returning({ id: ttsConfigTable.id });
    createdUserTtsIds.push(userTts!.id);

    const { partId } = await createPersonalWork(ownerUserId, TWO_PARAGRAPHS);

    // Owner-only work: strangers and anonymous readers cannot even see the manifest.
    const strangerManifest = await app.request(`/api/reader/parts/${partId}/audio/manifest?role=us`, {
      headers: { Cookie: stranger.cookie },
    });
    expect(strangerManifest.status).toBe(404);
    const anonymousManifest = await app.request(`/api/reader/parts/${partId}/audio/manifest?role=us`);
    expect(anonymousManifest.status).toBe(404);

    // Owner generates the segment under their BYOK scope.
    const ownerSegmentRes = await app.request(`/api/reader/parts/${partId}/audio/segments/0?role=us`, {
      headers: { Cookie: owner.cookie },
    });
    expect(ownerSegmentRes.status).toBe(200);
    const ownerSegment = (await ownerSegmentRes.json()) as ReaderAudioSegment;
    expect(ownerSegment.voice).toBe('en-US-AriaNeural');
    const [ownerRow] = await db
      .select()
      .from(partAudioSegmentTable)
      .where(eq(partAudioSegmentTable.partId, partId))
      .limit(1);
    expect(ownerRow!.scopeKey).toMatch(/^user:[0-9a-f]{16}$/);
    expect(ownerRow!.scopeKey).not.toContain(ownerUserId);
    expect(ownerRow!.storageKey).toContain(`reader-audio/user-`);

    // Owner streams their own segment.
    const ownerStream = await app.request(ownerSegment.audioUrl, { headers: { Cookie: owner.cookie } });
    expect(ownerStream.status).toBe(200);

    // Anonymous readers cannot stream a user-BYOK segment.
    const anonymousStream = await app.request(ownerSegment.audioUrl);
    expect(anonymousStream.status).toBe(404);

    // Another authenticated user resolves the instance scope, never the owner's row.
    const strangerStream = await app.request(ownerSegment.audioUrl, { headers: { Cookie: secondStranger.cookie } });
    expect(strangerStream.status).toBe(404);

    // A wrong hash never resolves an object.
    const wrongHash = ownerSegment.audioUrl.replace(/hash=[0-9a-f]{64}/, `hash=${'0'.repeat(64)}`);
    const wrongHashStream = await app.request(wrongHash, { headers: { Cookie: owner.cookie } });
    expect(wrongHashStream.status).toBe(404);
  });

  it('serves ranged audio with 206 and Content-Range', async () => {
    const learner = await createSession('lazy5');
    createdEmails.push(learner.email);
    const part = await createCatalogPart(TWO_PARAGRAPHS);

    const segmentRes = await app.request(`/api/reader/parts/${part.id}/audio/segments/0?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(segmentRes.status).toBe(200);
    const segment = (await segmentRes.json()) as ReaderAudioSegment;

    const ranged = await app.request(segment.audioUrl, {
      headers: { Cookie: learner.cookie, Range: 'bytes=0-3' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe(`bytes 0-3/${FAKE_MP3.length}`);
    expect(ranged.headers.get('content-length')).toBe('4');
    expect(ranged.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await ranged.arrayBuffer()).toString()).toBe('FAKE');

    const full = await app.request(segment.audioUrl, { headers: { Cookie: learner.cookie } });
    expect(full.status).toBe(200);
    expect(Buffer.from(await full.arrayBuffer()).toString()).toBe(FAKE_MP3.toString());
  });

  it('records a TTS invocation for every synthesis', async () => {
    const learner = await createSession('lazy6');
    createdEmails.push(learner.email);
    const part = await createCatalogPart(TWO_PARAGRAPHS);

    const res = await app.request(`/api/reader/parts/${part.id}/audio/segments/0?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(res.status).toBe(200);

    const logs = await db.select().from(ttsInvocationLogTable).where(eq(ttsInvocationLogTable.partId, part.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      status: 'success',
      source: 'reader_segment',
      role: 'us',
      voice: 'en-US-JennyNeural',
      cached: false,
    });
    expect(logs[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(logs[0]!.textLength).toBeGreaterThan(0);
  });

  it('keeps the wait budget above the lease so a slow winner never fails the waiter early (H2)', async () => {
    // Regression guard: WAIT_TIMEOUT_MS must be SEGMENT_LEASE_MS + 30s — the
    // old 30s budget was shorter than the 60s lease and 503'd losing waiters
    // while the winner was still synthesizing legally.
    expect(WAIT_TIMEOUT_MS).toBe(SEGMENT_LEASE_MS + 30_000);
    expect(WAIT_TIMEOUT_MS).toBeGreaterThan(SEGMENT_LEASE_MS);

    const learner = await createSession('lazyh2');
    createdEmails.push(learner.email);
    const part = await createCatalogPart(TWO_PARAGRAPHS);
    const { identity, derived } = instanceIdentityFor(part.id, 'us', 0);

    // Constructed lease row: holder is still inside a valid lease (slow winner).
    await insertLeaseRow(part.id, 'us', identity, derived, {
      status: 'generating',
      generationToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 1_500),
    });

    // An exhausted budget yields a takeover signal — never a thrown 503 (the
    // old implementation threw here). Injected short poll budget.
    const early = await waitForSegmentReady(identity, 200, 50);
    expect(early.kind).toBe('retry');

    // Winner publishes while a fresh waiter polls: the waiter observes ready.
    const winnerPublishes = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await db
        .update(partAudioSegmentTable)
        .set({ status: 'ready', generationToken: null, leaseExpiresAt: null, errorCode: null })
        .where(
          and(eq(partAudioSegmentTable.partId, part.id), eq(partAudioSegmentTable.segmentHash, identity.segmentHash)),
        );
    })();

    // Scaled-down injection of the production relationship (lease + margin).
    const waited = await waitForSegmentReady(identity, 1_500 + 1_000, 50);
    await winnerPublishes;
    expect(waited.kind).toBe('ready');
    if (waited.kind === 'ready') {
      expect(waited.row.status).toBe('ready');
      expect(waited.row.storageKey).toBe(identity.storageKey);
    }
  });

  it('signals takeover instead of idling when the holder lease expires or the row failed (M3)', async () => {
    const learner = await createSession('lazym3');
    createdEmails.push(learner.email);
    const part = await createCatalogPart(TWO_PARAGRAPHS);
    const { identity, derived } = instanceIdentityFor(part.id, 'us', 0);

    // Holder crashed: lease expired, status never changed.
    await insertLeaseRow(part.id, 'us', identity, derived, {
      status: 'generating',
      generationToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    const startedAt = Date.now();
    const expired = await waitForSegmentReady(identity, 10_000, 50);
    expect(expired.kind).toBe('retry');
    expect(Date.now() - startedAt).toBeLessThan(3_000); // prompt retry, no dead polling

    // Holder reported failure — waiter re-claims instead of waiting forever.
    await db
      .update(partAudioSegmentTable)
      .set({
        status: 'failed',
        generationToken: null,
        leaseExpiresAt: null,
        errorCode: 'api.errors.tts.synthesisFailed',
      })
      .where(
        and(eq(partAudioSegmentTable.partId, part.id), eq(partAudioSegmentTable.segmentHash, identity.segmentHash)),
      );
    const failed = await waitForSegmentReady(identity, 10_000, 50);
    expect(failed.kind).toBe('retry');
  });

  it('takes an expired lease over and synthesizes exactly once under concurrency (M3)', async () => {
    const learner = await createSession('lazytake');
    createdEmails.push(learner.email);
    const part = await createCatalogPart(TWO_PARAGRAPHS);
    const { identity, derived } = instanceIdentityFor(part.id, 'us', 0);

    // Holder crashed mid-generation: expired lease, stale token.
    await insertLeaseRow(part.id, 'us', identity, derived, {
      status: 'generating',
      generationToken: `stale-${randomUUID()}`,
      leaseExpiresAt: new Date(Date.now() - 5_000),
    });

    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(synthesizeAzureTts).mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 60));
      inFlight -= 1;
      return okSynthesis();
    });

    const [a, b] = await Promise.all([
      app.request(`/api/reader/parts/${part.id}/audio/segments/0?role=us`, { headers: { Cookie: learner.cookie } }),
      app.request(`/api/reader/parts/${part.id}/audio/segments/0?role=us`, { headers: { Cookie: learner.cookie } }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(synthesizeAzureTts).toHaveBeenCalledTimes(1);
    expect(maxInFlight).toBe(1);

    const rows = await db.select().from(partAudioSegmentTable).where(eq(partAudioSegmentTable.partId, part.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ready', errorCode: null, generationToken: null });
  });

  it('answers an out-of-range audio request with 416 and never 500 (M6)', async () => {
    const learner = await createSession('lazyrange');
    createdEmails.push(learner.email);
    const part = await createCatalogPart(TWO_PARAGRAPHS);

    const segmentRes = await app.request(`/api/reader/parts/${part.id}/audio/segments/0?role=us`, {
      headers: { Cookie: learner.cookie },
    });
    expect(segmentRes.status).toBe(200);
    const segment = (await segmentRes.json()) as ReaderAudioSegment;

    // Start at/beyond object size → 416 with the wildcard Content-Range.
    const beyond = await app.request(segment.audioUrl, {
      headers: { Cookie: learner.cookie, Range: `bytes=${FAKE_MP3.length}-` },
    });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe(`bytes */${FAKE_MP3.length}`);
    expect(beyond.headers.get('accept-ranges')).toBe('bytes');
    expect(await beyond.text()).toBe('');

    const farBeyond = await app.request(segment.audioUrl, {
      headers: { Cookie: learner.cookie, Range: 'bytes=1000-2000' },
    });
    expect(farBeyond.status).toBe(416);

    // Inverted bounds (end < start) are ignored — full body, 200.
    const inverted = await app.request(segment.audioUrl, {
      headers: { Cookie: learner.cookie, Range: 'bytes=10-2' },
    });
    expect(inverted.status).toBe(200);
    expect(Buffer.from(await inverted.arrayBuffer()).toString()).toBe(FAKE_MP3.toString());

    // A legal last-byte range still works.
    const lastByte = await app.request(segment.audioUrl, {
      headers: { Cookie: learner.cookie, Range: `bytes=${FAKE_MP3.length - 1}-` },
    });
    expect(lastByte.status).toBe(206);
    expect(lastByte.headers.get('content-range')).toBe(
      `bytes ${FAKE_MP3.length - 1}-${FAKE_MP3.length - 1}/${FAKE_MP3.length}`,
    );
  });

  it('memoizes segment derivation per part and body hash instead of re-parsing (M4)', () => {
    resetReaderAudioDeriveCache();
    try {
      const first = deriveReaderAudioSegmentsForPart('m4-part', TWO_PARAGRAPHS);
      const second = deriveReaderAudioSegmentsForPart('m4-part', TWO_PARAGRAPHS);
      // Same part + same body → derived once (same array instance).
      expect(second).toBe(first);
      expect(first.length).toBeGreaterThan(0);
      // Different body or different part → separate entries, same pure results.
      expect(deriveReaderAudioSegmentsForPart('m4-part', `${TWO_PARAGRAPHS}<p data-p="2">More.</p>`)).not.toBe(first);
      expect(deriveReaderAudioSegmentsForPart('m4-other', TWO_PARAGRAPHS)).not.toBe(first);

      // LRU bound of 32: the least-recently-used entry is evicted, refreshed ones survive.
      resetReaderAudioDeriveCache();
      const entries = Array.from({ length: 32 }, (_, i) => deriveReaderAudioSegmentsForPart(`p${i}`, TWO_PARAGRAPHS));
      deriveReaderAudioSegmentsForPart('p31', TWO_PARAGRAPHS); // refresh recency of p31
      deriveReaderAudioSegmentsForPart('p32', TWO_PARAGRAPHS); // 33rd entry → evict p0 (LRU)
      expect(deriveReaderAudioSegmentsForPart('p0', TWO_PARAGRAPHS)).not.toBe(entries[0]);
      expect(deriveReaderAudioSegmentsForPart('p31', TWO_PARAGRAPHS)).toBe(entries[31]);
    } finally {
      resetReaderAudioDeriveCache();
    }
  });
});
