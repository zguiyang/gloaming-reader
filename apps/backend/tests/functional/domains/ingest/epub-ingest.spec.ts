import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
  user as userTable,
} from '@gloaming/db';

import app from '@/app';
import { runContentParseWorkflow } from '@/application/commands/run-content-parse-workflow';
import { hashFileContent } from '@/domains/assets/uploads';
import { epubContentParser } from '@/domains/ingest/parser/epub-parser';
import { IMAGE_OPTIMIZER_TRANSFORM_VERSION } from '@/domains/ingest/parser/image-optimizer';
import { coverKey, imageKey, sha256 } from '@/domains/ingest/parser/parse-artifacts';
import { registerParser } from '@/domains/ingest/parser/registry';
import type { ParsedContent } from '@/domains/ingest/parser/types';
import { fillWorkMetadata } from '@/domains/metadata';
import { db } from '@/infra/db';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/infra/storage';

import { buildEpubBytes, buildSampleEpubBytes } from '../../../helpers/epub-builder';
import { createEpubWorkFixture } from '../../../helpers/epub-work-fixture';
import { createMemoryObjectStore } from '../../../helpers/memory-oss';

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

async function createUser() {
  const email = uniqueEmail('user');
  const username = `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  expect((await signUp({ email, username, name: 'user' })).status).toBe(200);
  await markEmailVerified(email);
  const [user] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  if (!user) throw new Error('Test user was not created');
  return { email, id: user.id };
}

async function createEpubWork(userId: string, bytes: Buffer, contentHashes: string[]) {
  contentHashes.push(hashFileContent(bytes));
  return createEpubWorkFixture({ userId, bytes, fileName: 'book.epub' });
}

describe('EPUB ingest pipeline', () => {
  const memory = createMemoryObjectStore();
  const createdWorkIds: string[] = [];
  const createdContentHashes: string[] = [];
  const createdEmails: string[] = [];
  let userId = '';

  beforeAll(async () => {
    memory.store.clear();
    setObjectStoreForTests(memory);
    const user = await createUser();
    createdEmails.push(user.email);
    userId = user.id;
  });

  afterAll(async () => {
    for (const workId of createdWorkIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
    if (createdContentHashes.length > 0) {
      await db.delete(uploadedObjectTable).where(inArray(uploadedObjectTable.contentHash, createdContentHashes));
    }
    for (const email of createdEmails) await db.delete(userTable).where(eq(userTable.email, email));
    resetObjectStoreCache();
  });

  it('parses a sample EPUB into chapters, metadata, cover and images', async () => {
    const bytes = await buildSampleEpubBytes();
    const created = await createEpubWork(userId, bytes, createdContentHashes);
    createdWorkIds.push(created.id);

    // Upload leaves the work in `uploaded`; run parse + fill synchronously.
    await runContentParseWorkflow(created.id);
    await db
      .update(readingWorkTable)
      .set({
        processingStatus: 'metadata',
      })
      .where(eq(readingWorkTable.id, created.id));
    await fillWorkMetadata(created.id);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.id));
    expect(work).toBeDefined();
    expect(work!.processingStatus).toBe('metadata');
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
    expect(cover!.storageKey).toMatch(new RegExp(`^covers/${created.id}/[^/]+/img-v1/[a-f0-9]{64}\\.jpg$`));
    expect(cover!.contentHash).toHaveLength(64);
    expect(cover!.meta?.transform).toBe('none');
    expect(cover!.meta?.transformVersion).toBe(IMAGE_OPTIMIZER_TRANSFORM_VERSION);
    expect(cover!.meta?.size).toBe(memory.store.get(cover!.storageKey!)!.body.length);
    expect(cover!.mimeType).toBe(memory.store.get(cover!.storageKey!)!.contentType);

    const parsed = work!.originMeta.parsed as { chapterCount: number; imageCount: number; authors: string[] };
    expect(parsed.chapterCount).toBe(3);
    expect(parsed.authors).toEqual(['Jane Author']);
  });

  it('stores versioned object keys and final bytes for optimized chapter images', async () => {
    const pngBytes = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const sourceHash = sha256(pngBytes);
    const bytes = await buildEpubBytes({
      title: 'Optimized Images',
      language: 'en',
      coverHref: 'cover.svg',
      coverBytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      chapters: [
        {
          href: 'chapter-1.xhtml',
          tocLabel: 'Chapter 1',
          content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head>
<body><h1>Chapter 1</h1><p><img src="images/fig1.png" alt="fig"/></p></body></html>`,
        },
      ],
      extraEntries: { 'images/fig1.png': pngBytes },
    });
    const created = await createEpubWork(userId, bytes, createdContentHashes);
    createdWorkIds.push(created.id);

    await runContentParseWorkflow(created.id);

    const assets = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, created.id));
    const image = assets.find((asset) => asset.kind === 'image');
    const cover = assets.find((asset) => asset.kind === 'cover');
    expect(image).toBeDefined();
    expect(cover).toBeDefined();

    const attemptMatch = image!.storageKey!.match(new RegExp(`^book-images/${created.id}/([^/]+)/img-v1/`));
    expect(attemptMatch).not.toBeNull();
    const attemptToken = attemptMatch![1]!;

    const expectedImageKey = imageKey(created.id, attemptToken, sourceHash, 'image/webp');
    expect(image!.storageKey).toBe(expectedImageKey);
    expect(image!.contentHash).toBe(sourceHash);
    expect(image!.mimeType).toBe('image/webp');
    expect(image!.meta?.sourceMimeType).toBe('image/png');
    expect(image!.meta?.sourceSize).toBe(pngBytes.length);
    expect(image!.meta?.size).toBeLessThan(pngBytes.length);
    expect(image!.meta?.transform).toBe('webp');
    expect(image!.meta?.transformVersion).toBe(IMAGE_OPTIMIZER_TRANSFORM_VERSION);

    const coverSourceHash = sha256(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(cover!.storageKey).toBe(coverKey(created.id, attemptToken!, coverSourceHash, 'image/svg+xml'));
    expect(cover!.mimeType).toBe('image/svg+xml');
    expect(cover!.meta?.transform).toBe('none');

    const storedImage = memory.store.get(expectedImageKey);
    expect(storedImage?.contentType).toBe('image/webp');
    expect(storedImage?.body.length).toBe(image!.meta?.size);

    const [part] = await db
      .select({ body: readingPartTable.body })
      .from(readingPartTable)
      .where(eq(readingPartTable.workId, created.id));
    expect(part!.body).toContain(`/api/assets/${image!.id}`);
  });

  it('keeps corrupt image bytes when optimization cannot run', async () => {
    const corruptPng = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const bytes = await buildEpubBytes({
      title: 'Corrupt Image Bytes',
      language: 'en',
      chapters: [
        {
          href: 'chapter-1.xhtml',
          tocLabel: 'Chapter 1',
          content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head>
<body><h1>Chapter 1</h1><p><img src="images/broken.png" alt="fig"/></p></body></html>`,
        },
      ],
      extraEntries: { 'images/broken.png': corruptPng },
    });
    const created = await createEpubWork(userId, bytes, createdContentHashes);
    createdWorkIds.push(created.id);

    await expect(runContentParseWorkflow(created.id)).resolves.toBe(true);

    const image = (await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, created.id))).find(
      (asset) => asset.kind === 'image',
    );
    expect(image).toBeDefined();
    expect(image!.contentHash).toBe(sha256(corruptPng));
    expect(image!.mimeType).toBe('image/png');
    expect(image!.meta?.transform).toBe('none');
    expect(image!.meta?.size).toBe(corruptPng.length);
    expect(memory.store.get(image!.storageKey!)?.body.equals(corruptPng)).toBe(true);
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
    const created = await createEpubWork(userId, bytes, createdContentHashes);
    createdWorkIds.push(created.id);

    await runContentParseWorkflow(created.id);

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
    const created = await createEpubWork(userId, badBytes, createdContentHashes);
    createdWorkIds.push(created.id);

    await expect(runContentParseWorkflow(created.id)).rejects.toThrow();

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.id));
    expect(work!.processingStatus).toBe('failed');
    expect(String(work!.originMeta.lastError ?? '')).toContain('container.xml');
  });

  it('fences a stale parse attempt after a new owner commits parts and objects', async () => {
    const created = await createEpubWork(userId, await buildSampleEpubBytes(), createdContentHashes);
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
      kind: 'user_epub',
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
      const staleAttempt = runContentParseWorkflow(created.id, undefined, 'attempt-a');
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

      await expect(runContentParseWorkflow(created.id, undefined, 'attempt-b')).resolves.toBe(true);
      releaseAttemptA();
      await expect(staleAttempt).resolves.toBe(false);

      const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.id));
      const parts = await db.select().from(readingPartTable).where(eq(readingPartTable.workId, created.id));
      const assets = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, created.id));
      expect(work!.processingStatus).toBe('ready');
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
