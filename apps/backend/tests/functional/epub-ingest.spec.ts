import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
  user as userTable,
} from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/db';
import { failWorkflowEnqueue, rotateWorkflowJobToken } from '@/lib/workflow';
import { processContentWork } from '@/modules/content-parser';
import { registerParser } from '@/modules/content-parser/registry';
import type { ParsedContent } from '@/modules/content-parser/types';
import { epubContentParser } from '@/modules/epub-ingest';
import { resetMetadataAiOutputs } from '@/modules/ingest-reset/service';
import { fillWorkMetadata } from '@/modules/metadata-fill/service';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/modules/oss';
import { hashFileContent } from '@/modules/uploads/service';

import { buildEpubBytes, buildSampleEpubBytes } from '../helpers/epub-builder';
import { createMemoryObjectStore } from '../helpers/memory-oss';

const password = 'password123';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function parsedAttemptContent(label: string, imageByte: number): ParsedContent {
  const token = `{{${label}-image}}`;
  return {
    metadata: {
      title: `${label} title`,
      authors: [`${label} author`],
      description: `${label} description`,
      language: 'en',
      subjects: [],
      sourceRaw: '',
    },
    chapters: [{ title: `${label} chapter`, html: `<p>${label}</p><img src="${token}">` }],
    images: [{ token, href: `${label}.png`, mime: 'image/png', bytes: Buffer.from([imageByte]) }],
    cover: { bytes: Buffer.from([imageByte + 1]), mime: 'image/png', originalPath: `${label}-cover.png` },
    stats: { spineCount: 1, navCount: 1, chapterCount: 1 },
  };
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

async function createAdminSession() {
  const email = uniqueEmail('admin');
  const username = `admin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  expect((await signUp({ email, username, name: 'admin' })).status).toBe(200);
  await markEmailVerified(email);
  await setUserRole(email, AUTH_ADMIN_ROLE);
  const login = await signInEmail(email);
  expect(login.status).toBe(200);
  return cookieHeader(login);
}

async function uploadEpub(cookie: string, bytes: Buffer, contentHashes: string[]) {
  contentHashes.push(hashFileContent(bytes));
  const form = new FormData();
  form.append('file', new File([new Blob([bytes])], 'book.epub', { type: 'application/epub+zip' }));
  return app.request('/api/admin/works/epub', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
}

describe('EPUB ingest pipeline', () => {
  const memory = createMemoryObjectStore();
  const createdWorkIds: string[] = [];
  const createdContentHashes: string[] = [];
  let adminCookie = '';

  beforeAll(async () => {
    memory.store.clear();
    setObjectStoreForTests(memory);
    adminCookie = await createAdminSession();
  });

  afterAll(async () => {
    for (const workId of createdWorkIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
    if (createdContentHashes.length > 0) {
      await db.delete(uploadedObjectTable).where(inArray(uploadedObjectTable.contentHash, createdContentHashes));
    }
    resetObjectStoreCache();
  });

  it('parses a sample EPUB into chapters, metadata, cover and images', async () => {
    const bytes = await buildSampleEpubBytes();
    const response = await uploadEpub(adminCookie, bytes, createdContentHashes);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);

    // Upload leaves the work in `uploaded`; run parse + fill synchronously.
    await processContentWork(created.id);
    await db.update(readingWorkTable).set({ status: 'metadata' }).where(eq(readingWorkTable.id, created.id));
    await fillWorkMetadata(created.id);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.id));
    expect(work).toBeDefined();
    expect(work!.status).toBe('metadata');
    expect(work!.title).toBe('The Great Book');
    expect(work!.author).toBe('Jane Author');
    expect(work!.description).toBe('A sample story.');
    expect(work!.language).toBe('en');

    const parts = await db
      .select()
      .from(readingPartTable)
      .where(eq(readingPartTable.workId, created.id))
      .orderBy(readingPartTable.sortOrder);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
    expect(parts.map((p) => p.kind)).toEqual(['chapter', 'chapter', 'chapter']);
    expect(parts[0]!.body).toContain('Call me Ishmael.');
    expect(parts[0]!.body).toContain('data-p=');

    const assets = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, created.id));
    const cover = assets.find((a) => a.kind === 'cover');
    expect(cover).toBeDefined();
    expect(work!.coverAssetId).toBe(cover!.id);

    const parsed = work!.originMeta.parsed as { chapterCount: number; imageCount: number; authors: string[] };
    expect(parsed.chapterCount).toBe(3);
    expect(parsed.authors).toEqual(['Jane Author']);
  });

  it('handles a single-file EPUB split by headings and drops front matter', async () => {
    const bytes = await buildEpubBytes({
      title: 'Single Book',
      chapters: [
        {
          href: 'all.xhtml',
          content: `<html xmlns="http://www.w3.org/1999/xhtml"><body>
            <h2>Contents</h2><p>list</p>
            <h2>Chapter 1</h2><p>First.</p>
            <h2>Chapter 2</h2><p>Second.</p>
            <h2>Chapter 3</h2><p>Third.</p>
          </body></html>`,
        },
      ],
    });
    const response = await uploadEpub(adminCookie, bytes, createdContentHashes);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);

    await processContentWork(created.id);

    const parts = await db
      .select()
      .from(readingPartTable)
      .where(eq(readingPartTable.workId, created.id))
      .orderBy(readingPartTable.sortOrder);
    expect(parts.map((p) => p.title)).toEqual(['Part Chapter 1', 'Part Chapter 2', 'Part Chapter 3']);
    expect(parts.map((p) => (p.body.join ? '' : p.body)).join('')).toContain('First.');
  });

  it('marks the work failed when parsing fails', async () => {
    const zip = new (await import('jszip')).default();
    zip.file('random.txt', 'not an epub');
    const badBytes = await zip.generateAsync({ type: 'nodebuffer' });
    const response = await uploadEpub(adminCookie, badBytes, createdContentHashes);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);

    await expect(processContentWork(created.id)).rejects.toThrow();

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.id));
    expect(work!.status).toBe('failed');
    expect(String(work!.originMeta.lastError ?? '')).toContain('container.xml');
  });

  it('fences a stale parse attempt after a new owner commits parts and objects', async () => {
    const response = await uploadEpub(adminCookie, await buildSampleEpubBytes(), createdContentHashes);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);

    const attemptA = parsedAttemptContent('attempt-a', 11);
    const attemptB = parsedAttemptContent('attempt-b', 22);
    let parseCalls = 0;
    let releaseAttemptA!: () => void;
    let attemptAStarted!: () => void;
    const attemptARelease = new Promise<void>((resolve) => {
      releaseAttemptA = resolve;
    });
    const attemptAEntered = new Promise<void>((resolve) => {
      attemptAStarted = resolve;
    });
    registerParser({
      kind: 'admin_epub',
      parse: async () => {
        parseCalls += 1;
        if (parseCalls === 1) {
          attemptAStarted();
          await attemptARelease;
          return attemptA;
        }
        return attemptB;
      },
    });

    try {
      const staleAttempt = processContentWork(created.id, undefined, 'attempt-a');
      await attemptAEntered;
      const [claimed] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.id));
      expect(claimed!.originMeta.workflowClaimAttempt).toBe('attempt-a');
      await db
        .update(readingWorkTable)
        .set({
          originMeta: {
            ...claimed!.originMeta,
            workflowClaimLeaseExpiresAt: new Date(0).toISOString(),
          },
        })
        .where(eq(readingWorkTable.id, created.id));

      await expect(processContentWork(created.id, undefined, 'attempt-b')).resolves.toBe(true);
      releaseAttemptA();
      await expect(staleAttempt).resolves.toBe(false);

      const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.id));
      const parts = await db.select().from(readingPartTable).where(eq(readingPartTable.workId, created.id));
      const assets = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, created.id));
      expect(work!.status).toBe('parsed');
      expect(parts).toHaveLength(1);
      expect(parts[0]!.body).toContain('attempt-b');
      expect(assets.filter((asset) => asset.kind === 'image')).toHaveLength(1);
      expect(memory.store.has(assets.find((asset) => asset.kind === 'image')!.storageKey!)).toBe(true);
      expect([...memory.store.keys()].filter((key) => key.startsWith(`book-images/${created.id}/`))).toHaveLength(1);
      expect([...memory.store.keys()].filter((key) => key.startsWith(`covers/${created.id}/`))).toHaveLength(1);
    } finally {
      registerParser(epubContentParser);
    }
  });
});

describe('POST /api/admin/works/:id/workflow/retry', () => {
  const memory = createMemoryObjectStore();
  const createdWorkIds: string[] = [];
  const createdContentHashes: string[] = [];
  let adminCookie = '';

  beforeAll(async () => {
    memory.store.clear();
    setObjectStoreForTests(memory);
    adminCookie = await createAdminSession();
  });

  afterAll(async () => {
    for (const workId of createdWorkIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
    if (createdContentHashes.length > 0) {
      await db.delete(uploadedObjectTable).where(inArray(uploadedObjectTable.contentHash, createdContentHashes));
    }
    resetObjectStoreCache();
  });

  async function retryRequest(id: string, body?: Record<string, unknown>) {
    return app.request(`/api/admin/works/${id}/workflow/retry`, {
      method: 'POST',
      headers: { Cookie: adminCookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function uploadAndRun(): Promise<string> {
    const response = await uploadEpub(adminCookie, await buildSampleEpubBytes(), createdContentHashes);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);
    await processContentWork(created.id);
    await db.update(readingWorkTable).set({ status: 'metadata' }).where(eq(readingWorkTable.id, created.id));
    await fillWorkMetadata(created.id);
    return created.id;
  }

  it('resumes a failed work from its failed step (no body)', async () => {
    const workId = await uploadAndRun();

    await db
      .update(readingWorkTable)
      .set({ status: 'failed', originMeta: { failedStep: 'metadata', lastError: 'simulated failure' } })
      .where(eq(readingWorkTable.id, workId));

    const retry = await retryRequest(workId);
    expect(retry.status).toBe(200);
    const body = (await retry.json()) as { status: string; failedStep: string | null };
    expect(body.status).toBe('metadata');
    expect(body.failedStep).toBeNull();

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.status).toBe('metadata');
    expect(work!.originMeta.lastError).toBeUndefined();
  });

  it('refuses to retry published works', async () => {
    const workId = await uploadAndRun();
    await db.update(readingWorkTable).set({ status: 'ready' }).where(eq(readingWorkTable.id, workId));
    await app.request(`/api/admin/works/${workId}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: ['demo'], tags: ['story'] }),
    });
    await app.request(`/api/admin/works/${workId}/publish`, { method: 'POST', headers: { Cookie: adminCookie } });

    const retry = await retryRequest(workId, { step: 'parse' });
    expect(retry.status).toBe(409);
  });

  it('refuses to retry while processing', async () => {
    const response = await uploadEpub(adminCookie, await buildSampleEpubBytes(), createdContentHashes);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);
    await db.update(readingWorkTable).set({ status: 'processing' }).where(eq(readingWorkTable.id, created.id));

    const retry = await retryRequest(created.id, { step: 'parse' });
    expect(retry.status).toBe(409);
  });

  it('allows the admin to recover an expired parse lease, but not an active one', async () => {
    const response = await uploadEpub(adminCookie, await buildSampleEpubBytes(), createdContentHashes);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);
    const oldAttempt = 'expired-parse-attempt';
    await db
      .update(readingWorkTable)
      .set({
        status: 'processing',
        originMeta: {
          retryJobToken: 'expired-retry-token',
          workflowClaimStep: 'parse',
          workflowClaimAttempt: oldAttempt,
          workflowClaimLeaseExpiresAt: new Date(0).toISOString(),
        },
      })
      .where(eq(readingWorkTable.id, created.id));

    const retry = await retryRequest(created.id, { step: 'parse' });
    expect(retry.status).toBe(200);
    const [recovered] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.id));
    expect(recovered!.status).toBe('processing');
    expect(recovered!.originMeta.workflowEnqueueStep).toBe('parse');
    expect(recovered!.originMeta.workflowEnqueueAttempt).not.toBe(oldAttempt);
  });

  it('compensates parse-to-metadata enqueue failure only for the persisted enqueue attempt', async () => {
    const response = await uploadEpub(adminCookie, await buildSampleEpubBytes(), createdContentHashes);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);
    const parseAttempt = 'parse-attempt';
    const enqueueAttempt = 'metadata-enqueue-attempt';
    const originMeta = {
      retryJobToken: 'parse-retry-token',
      workflowClaimStep: 'parse',
      workflowClaimAttempt: parseAttempt,
      workflowClaimLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    await db
      .update(readingWorkTable)
      .set({ status: 'processing', originMeta })
      .where(eq(readingWorkTable.id, created.id));
    await expect(
      rotateWorkflowJobToken(
        created.id,
        'parse',
        'processing',
        'parse-retry-token',
        parseAttempt,
        'metadata-retry-token',
        enqueueAttempt,
        'metadata',
        'metadata',
      ),
    ).resolves.toBe(true);

    await expect(
      failWorkflowEnqueue(
        created.id,
        'metadata',
        'metadata-retry-token',
        'metadata',
        'stale-attempt',
        new Error('queue down'),
      ),
    ).resolves.toBe(false);
    const [stillMetadata] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.id));
    expect(stillMetadata!.status).toBe('metadata');

    await expect(
      failWorkflowEnqueue(
        created.id,
        'metadata',
        'metadata-retry-token',
        'metadata',
        enqueueAttempt,
        new Error('queue down'),
      ),
    ).resolves.toBe(true);
    const [failed] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.id));
    expect(failed!.status).toBe('failed');
    expect(failed!.originMeta.failedStep).toBe('metadata');
  });

  it('re-running parse overwrites hand-edited fields with parsed values', async () => {
    const workId = await uploadAndRun();
    await db.update(readingWorkTable).set({ status: 'ready' }).where(eq(readingWorkTable.id, workId));
    await app.request(`/api/admin/works/${workId}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Edited Title', author: 'Edited Author', description: 'Edited description' }),
    });

    const retry = await retryRequest(workId, { step: 'parse' });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { status: string }).status).toBe('processing');

    const beforeParts = await db
      .select({ id: readingPartTable.id })
      .from(readingPartTable)
      .where(eq(readingPartTable.workId, workId));
    const staleImageKey = `stale/${workId}/image.png`;
    const staleCoverKey = `stale/${workId}/cover.png`;
    const staleAudioSegmentKey = `stale/${workId}/audio-us/segment.mp3`;
    const staleAudioChapterKey = `stale/${workId}/audio-us/chapter.mp3`;
    memory.store.set(staleImageKey, { body: Buffer.from('stale image'), contentType: 'image/png' });
    memory.store.set(staleCoverKey, { body: Buffer.from('stale cover'), contentType: 'image/png' });
    memory.store.set(staleAudioSegmentKey, { body: Buffer.from('stale audio segment'), contentType: 'audio/mpeg' });
    memory.store.set(staleAudioChapterKey, { body: Buffer.from('stale audio chapter'), contentType: 'audio/mpeg' });
    await db.insert(contentAssetTable).values([
      {
        id: `stale-image-${workId}`,
        workId,
        kind: 'image',
        storageKey: staleImageKey,
        mimeType: 'image/png',
        contentHash: 'stale-image-hash',
        status: 'ready',
      },
      {
        id: `stale-cover-${workId}`,
        workId,
        kind: 'cover',
        storageKey: staleCoverKey,
        mimeType: 'image/png',
        contentHash: 'stale-cover-hash',
        status: 'ready',
      },
      {
        id: `stale-audio-${workId}`,
        workId,
        partId: null,
        kind: 'audio_us',
        storageKey: staleAudioChapterKey,
        mimeType: 'audio/mpeg',
        contentHash: 'stale-audio-hash',
        status: 'ready',
        meta: { objectKeys: [staleAudioSegmentKey, staleAudioChapterKey], timeline: [] },
      },
    ]);

    const [mid] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(mid!.status).toBe('processing');

    await processContentWork(workId);
    await db.update(readingWorkTable).set({ status: 'metadata' }).where(eq(readingWorkTable.id, workId));
    await fillWorkMetadata(workId);

    const afterAssets = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, workId));
    expect(afterAssets.filter((asset) => asset.kind === 'image')).toHaveLength(0);
    expect(afterAssets.filter((asset) => asset.kind === 'cover')).toHaveLength(1);
    expect(afterAssets.filter((asset) => asset.kind.startsWith('audio_'))).toHaveLength(0);
    expect(memory.store.has(staleImageKey)).toBe(false);
    expect(memory.store.has(staleCoverKey)).toBe(false);
    expect(memory.store.has(staleAudioSegmentKey)).toBe(false);
    expect(memory.store.has(staleAudioChapterKey)).toBe(false);

    const afterParts = await db
      .select({ id: readingPartTable.id })
      .from(readingPartTable)
      .where(eq(readingPartTable.workId, workId));
    expect(afterParts.map((part) => part.id)).not.toEqual(beforeParts.map((part) => part.id));

    const [after] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(after!.status).toBe('metadata');
    expect(after!.title).toBe('The Great Book');
    expect(after!.author).toBe('Jane Author');
    expect(after!.description).toBe('A sample story.');
  });

  it('re-running the metadata step clears AI outputs before the next run', async () => {
    const workId = await uploadAndRun();
    await db
      .update(readingWorkTable)
      .set({ status: 'ready', description: 'AI filled summary', descriptionProvenance: 'ai' })
      .where(eq(readingWorkTable.id, workId));

    const retry = await retryRequest(workId, { step: 'metadata' });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { status: string }).status).toBe('metadata');

    // HTTP only queues — AI field wipe runs inside the fill job.
    const [beforeReset] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(beforeReset!.description).toBe('AI filled summary');
    await resetMetadataAiOutputs(beforeReset!);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.description).toBe('');
    expect(work!.descriptionProvenance).toBeNull();
  });

  it('requires a failure or an explicit step, and refuses the tts step for now', async () => {
    const workId = await uploadAndRun();
    await db.update(readingWorkTable).set({ status: 'ready' }).where(eq(readingWorkTable.id, workId));

    const noStep = await retryRequest(workId);
    expect(noStep.status).toBe(400);

    const tts = await retryRequest(workId, { step: 'tts' });
    expect(tts.status).toBe(400);

    const text = await app.request('/api/admin/works', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Text Guard', body: '<p>Body.</p>' }),
    });
    const textWork = (await text.json()) as { id: string };
    createdWorkIds.push(textWork.id);
    const nonEpub = await retryRequest(textWork.id, { step: 'parse' });
    expect(nonEpub.status).toBe(400);
  });
});
