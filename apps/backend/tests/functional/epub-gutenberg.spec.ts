import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
import { processContentWork } from '@/modules/content-parser';
import { planChapters } from '@/modules/epub-ingest/chapters';
import { cleanXhtml } from '@/modules/epub-ingest/clean';
import { parseEpub } from '@/modules/epub-ingest/epub';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/modules/oss';
import { hashFileContent } from '@/modules/uploads/service';

import { buildEpubBytes } from '../helpers/epub-builder';
import { createMemoryObjectStore } from '../helpers/memory-oss';

const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/pg11339.epub', import.meta.url));
const FIXTURE_BYTES = readFileSync(FIXTURE_PATH);

const password = 'password123';

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
    body: JSON.stringify({ email: input.email, password, name: input.name, username: input.username }),
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

async function uploadEpub(cookie: string, bytes: Buffer, contentHashes: string[], fileName = 'book.epub') {
  contentHashes.push(hashFileContent(bytes));
  const form = new FormData();
  form.append('file', new File([new Blob([bytes])], fileName, { type: 'application/epub+zip' }));
  return app.request('/api/admin/works/epub', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
}

/** Plan chapters exactly as the ingest service does (no DB side effects). */
async function planFixtureEpub(bytes: Buffer) {
  const book = await parseEpub(bytes);
  return planChapters(book, (href, rawHtml) => {
    const cleaned = cleanXhtml(rawHtml, (src) => src);
    return { title: '', html: cleaned.html, images: cleaned.images };
  });
}

describe('Gutenberg EPUB regression (fixtures/pg11339.epub)', () => {
  it('parses the NCX navigation (navLabel bug)', async () => {
    const book = await parseEpub(FIXTURE_BYTES);
    expect(book.nav.length).toBeGreaterThan(0);
    expect(book.nav[0]!.label).toBe("AESOP'S FABLES");
    // NCX hrefs are resolved against the OPF directory.
    expect(book.nav[0]!.href).toContain('OEBPS/');
  });

  it('drops the cover wrapper page and produces the textstack chapter titles', async () => {
    const chapters = await planFixtureEpub(FIXTURE_BYTES);
    // spine = [cover wrapper, 10 content files]; cover wrapper must not
    // become a "Section 1" chapter. (The user's upload batch has 11 content
    // files → 11 chapters, matching textstack.)
    expect(chapters).toHaveLength(10);
    expect(chapters.map((c) => c.title)).toEqual([
      "AESOP'S FABLES",
      'LIST OF ILLUSTRATIONS',
      "THE WOLF IN SHEEP'S CLOTHING",
      "THE ASS IN THE LION'S SKIN",
      'THE OX AND THE FROG',
      'THE TUNNY-FISH AND THE DOLPHIN',
      'THE STAG AND THE VINE',
      'THE ASS AND THE DOG',
      'THE IMPOSTOR',
      'PROMETHEUS AND THE MAKING OF MAN',
    ]);
  });

  it('keeps Gutenberg author info, drops head leaks and the contents page', async () => {
    const chapters = await planFixtureEpub(FIXTURE_BYTES);
    const all = chapters.map((c) => c.html).join('\n');
    // No XML declaration / head leaks anywhere.
    expect(all).not.toContain('<?xml');
    expect(all).not.toContain('<!--?xml');
    // Author info page is preserved (textstack keeps #pg-header + START marker).
    expect(all).toContain('pg-header');
    expect(all).toContain('START OF THE PROJECT GUTENBERG');
    expect(all).toContain('<strong>Title</strong>');
    // Head <title> no longer leaks into every chapter (only the kept author
    // block in chapter 1 may mention the book).
    const rest = chapters
      .slice(1)
      .map((c) => c.html)
      .join('\n');
    expect(rest).not.toContain('The Project Gutenberg eBook of');
    // The in-chapter contents page is dropped (product has its own navigation);
    // LIST OF ILLUSTRATIONS keeps its own link list as legitimate content.
    expect(chapters[0]!.html).not.toContain('>CONTENTS<');
    expect(chapters[0]!.html).not.toContain('pginternal');
    // Blacklist cleaning preserves structural tags like div/table.
    expect(all).toContain('<div');
    // Gutenberg noimages stubs (span#img_*) are stripped for immersive reading.
    expect(all).not.toContain('img_images_');
    expect(all).not.toContain('id="img_');
  });
});

describe('EPUB ingest pipeline with real Gutenberg book (integration)', () => {
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

  it('stores clean parts, nav metadata and no cover chapter', async () => {
    const response = await uploadEpub(adminCookie, FIXTURE_BYTES, createdContentHashes, 'Aesop Fables.epub');
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);

    await processContentWork(created.id);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.id));
    expect(work!.status).toBe('parsed');
    const parsed = work!.originMeta.parsed as { chapterCount: number; navCount: number; imageCount: number };
    expect(parsed.navCount).toBeGreaterThan(0);
    expect(parsed.chapterCount).toBe(10);
    expect(parsed.imageCount).toBe(0);

    const parts = await db
      .select()
      .from(readingPartTable)
      .where(eq(readingPartTable.workId, created.id))
      .orderBy(readingPartTable.sortOrder);
    expect(parts.map((p) => p.title)[0]).toBe("AESOP'S FABLES");
    // Noimages caption stubs must not survive into stored chapter bodies.
    const allBodies = parts.map((p) => p.body).join('\n');
    expect(allBodies).not.toContain('img_images_');
    expect(allBodies).not.toContain('__GLOAMING_IMG__');
    // Author info page preserved in the first chapter; every other chapter
    // must be free of head leaks and the XML declaration.
    expect(parts[0]!.body).toContain('pg-header');
    for (const part of parts) {
      expect(part.body).not.toContain('<?xml');
    }
    for (const part of parts.slice(1)) {
      expect(part.body).not.toContain('The Project Gutenberg eBook of');
    }
    expect(parts[0]!.body).not.toContain('pginternal');
  });
});

describe('EPUB cleaning & chaptering fixes (builder fixtures)', () => {
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

  async function runEpub(bytes: Buffer): Promise<string> {
    const response = await uploadEpub(adminCookie, bytes, createdContentHashes);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);
    await processContentWork(created.id);
    return created.id;
  }

  it('keeps body images whose src is relative to the OPF directory', async () => {
    const bytes = await buildEpubBytes({
      title: 'Pictured Book',
      language: 'en',
      coverHref: 'cover.jpg',
      coverBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      chapters: [
        {
          href: 'chapter-1.xhtml',
          tocLabel: 'Chapter 1',
          content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head>
<body><h1>Chapter 1</h1><p>A figure: <img src="images/fig1.png" alt="fig"/></p></body></html>`,
        },
      ],
      extraEntries: { 'images/fig1.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    });
    const workId = await runEpub(bytes);

    const imageAssets = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, workId));
    const bodyImages = imageAssets.filter((a) => a.kind === 'image');
    expect(bodyImages).toHaveLength(1);
    expect(bodyImages[0]!.meta?.originalPath).toBe('OEBPS/images/fig1.png');

    const [part] = await db
      .select({ body: readingPartTable.body })
      .from(readingPartTable)
      .where(eq(readingPartTable.workId, workId));
    expect(part!.body).toContain(`/api/assets/${bodyImages[0]!.id}`);
    expect(part!.body).not.toContain('<img src="">');
  });

  it('resolves chapter-relative ../ image paths from nested spine files', async () => {
    const bytes = await buildEpubBytes({
      title: 'Nested Images',
      language: 'en',
      chapters: [
        {
          href: 'Text/chapter-1.xhtml',
          tocLabel: 'Chapter 1',
          content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head>
<body><h1>Chapter 1</h1><p><img src="../Images/fig1.png" alt="fig"/></p></body></html>`,
        },
      ],
      extraEntries: { 'Images/fig1.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    });
    const workId = await runEpub(bytes);

    const bodyImages = (await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, workId))).filter(
      (a) => a.kind === 'image',
    );
    expect(bodyImages).toHaveLength(1);
    expect(bodyImages[0]!.meta?.originalPath).toBe('OEBPS/Images/fig1.png');

    const [part] = await db
      .select({ body: readingPartTable.body })
      .from(readingPartTable)
      .where(eq(readingPartTable.workId, workId));
    expect(part!.body).toContain(`/api/assets/${bodyImages[0]!.id}`);
    expect(part!.body).not.toContain('__GLOAMING_IMG__');
  });

  it('drops cover wrapper page (no text, no title) instead of a "Section 1"', async () => {
    const bytes = await buildEpubBytes({
      title: 'Covered Book',
      language: 'en',
      coverHref: 'cover.jpg',
      coverBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      chapters: [
        {
          href: 'cover.xhtml',
          content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>"Cover"</title></head>
<body><div style="text-align:center"><img src="cover.jpg" alt="" class="x-ebookmaker-cover"/></div></body></html>`,
        },
        {
          href: 'chapter-1.xhtml',
          tocLabel: 'Chapter 1',
          content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head>
<body><h1>Chapter 1</h1><p>Real prose.</p></body></html>`,
        },
      ],
    });
    const workId = await runEpub(bytes);

    const parts = await db
      .select({ title: readingPartTable.title, sortOrder: readingPartTable.sortOrder })
      .from(readingPartTable)
      .where(eq(readingPartTable.workId, workId))
      .orderBy(readingPartTable.sortOrder);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.title).toBe('Chapter 1');
  });

  it('keeps Gutenberg author info while dropping <head> leaks and scripts', async () => {
    const bytes = await buildEpubBytes({
      title: 'Clean Book',
      language: 'en',
      chapters: [
        {
          href: 'chapter-1.xhtml',
          tocLabel: 'Chapter 1',
          content: `<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<title>The Project Gutenberg eBook of Clean Book, by Author.</title>
<style>b{}</style><link rel="stylesheet" href="0.css"/>
<script>alert(1)</script>
</head>
<body><div class="pg-boilerplate" id="pg-header"><h2 id="pg-header-heading">The Project Gutenberg eBook of Clean Book</h2>
<div>This eBook is for the use of anyone anywhere.</div></div>
<h1>Chapter 1</h1><p>Actual reading prose.</p></body></html>`,
        },
      ],
    });
    const workId = await runEpub(bytes);

    const [part] = await db
      .select({ body: readingPartTable.body })
      .from(readingPartTable)
      .where(eq(readingPartTable.workId, workId));
    expect(part!.body).toContain('Actual reading prose');
    // Author info page kept (textstack behavior).
    expect(part!.body).toContain('pg-header');
    expect(part!.body).toContain('This eBook is for the use of anyone anywhere');
    // head leaks, scripts and styles are gone.
    expect(part!.body).not.toContain('<?xml');
    expect(part!.body).not.toContain('<script');
    expect(part!.body).not.toContain('<style');
    expect(part!.body).not.toContain('<link');
  });

  it('keeps a chapter whose body lives inside #pg-footer (license file)', async () => {
    const bytes = await buildEpubBytes({
      title: 'Licensed Book',
      language: 'en',
      chapters: [
        {
          href: 'chapter-1.xhtml',
          tocLabel: 'Chapter 1',
          content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head>
<body><h1>Chapter 1</h1><p>Real prose.</p></body></html>`,
        },
        {
          href: 'license.xhtml',
          content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>License</title></head>
<body><div class="pg-boilerplate" id="pg-footer">
<div id="pg-end-separator"><span>*** END OF THE PROJECT GUTENBERG EBOOK LICENSED BOOK ***</span></div>
<h2 id="pg-footer-heading">THE FULL PROJECT GUTENBERG LICENSE</h2>
<p>Updated editions will replace the previous one.</p>
</div></body></html>`,
        },
      ],
    });
    const workId = await runEpub(bytes);

    const parts = await db
      .select({ title: readingPartTable.title, body: readingPartTable.body })
      .from(readingPartTable)
      .where(eq(readingPartTable.workId, workId))
      .orderBy(readingPartTable.sortOrder);
    expect(parts.map((p) => p.title)).toEqual(['Chapter 1', 'THE FULL PROJECT GUTENBERG LICENSE']);
    expect(parts[1]!.body).toContain('Updated editions will replace');
    // The END marker lives inside the license body and is kept (textstack keeps it).
    expect(parts[1]!.body).toContain('*** END OF THE PROJECT GUTENBERG');
  });
});
