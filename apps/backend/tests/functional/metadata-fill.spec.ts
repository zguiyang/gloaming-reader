import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkSource as readingWorkSourceTable,
  readingWorkTag as readingWorkTagTable,
  source as sourceTable,
  tag as tagTable,
  uploadedObject as uploadedObjectTable,
  user as userTable,
} from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/db';
import { claimWorkflowStep, completeWorkflowStep, failWorkflowStep } from '@/lib/workflow';
import { processContentWork } from '@/modules/content-parser';
import { fillWorkMetadata } from '@/modules/metadata-fill/service';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/modules/oss';
import { hashFileContent } from '@/modules/uploads/service';

import { buildEpubBytes } from '../helpers/epub-builder';
import { createMemoryObjectStore } from '../helpers/memory-oss';

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

describe('metadata-fill rule layer (extracted) + updateWork (manual)', () => {
  const memory = createMemoryObjectStore();
  const createdWorkIds: string[] = [];
  const createdContentHashes: string[] = [];
  const createdTagIds: string[] = [];
  let adminCookie = '';
  const testSourceId = 'src-standard-ebooks';

  beforeAll(async () => {
    memory.store.clear();
    setObjectStoreForTests(memory);
    const email = uniqueEmail('admin');
    const username = `admin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password, name: 'admin', username }),
    });
    await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
    await db.update(userTable).set({ role: AUTH_ADMIN_ROLE }).where(eq(userTable.email, email));
    const login = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password }),
    });
    adminCookie = cookieHeader(login);

    await db
      .insert(sourceTable)
      .values({
        id: testSourceId,
        name: 'Standard Ebooks',
        matchRule: 'standardebooks.org',
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    for (const workId of createdWorkIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
    await db.delete(sourceTable).where(eq(sourceTable.id, testSourceId));
    if (createdContentHashes.length > 0) {
      await db.delete(uploadedObjectTable).where(inArray(uploadedObjectTable.contentHash, createdContentHashes));
    }
    if (createdTagIds.length > 0) {
      await db.delete(tagTable).where(inArray(tagTable.id, createdTagIds));
    }
    resetObjectStoreCache();
  });

  async function uploadAndFill(bytes: Buffer): Promise<string> {
    createdContentHashes.push(hashFileContent(bytes));
    const form = new FormData();
    form.append('file', new File([new Blob([bytes])], 'book.epub', { type: 'application/epub+zip' }));
    const response = await app.request('/api/admin/works/epub', {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: form,
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);
    await processContentWork(created.id);
    await fillWorkMetadata(created.id);
    return created.id;
  }

  async function patchWork(id: string, body: Record<string, unknown>): Promise<Response> {
    return app.request(`/api/admin/works/${id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('writes extracted tag/source associations via junction SSOT', async () => {
    const workId = await uploadAndFill(
      await buildEpubBytes({
        title: 'Subject Book',
        subjects: ['Zeta Alpha', 'Zeta Beta'],
        sourceRaw: 'https://standardebooks.org/ebooks/some-book',
        chapters: [
          { href: 'chapter-1.xhtml', tocLabel: 'Chapter 1', content: '<html><body><p>Body.</p></body></html>' },
        ],
      }),
    );

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.title).toBe('Subject Book');

    const detail = await app.request(`/api/admin/works/${workId}`, { headers: { Cookie: adminCookie } });
    expect(detail.status).toBe(200);
    const apiWork = (await detail.json()) as {
      tags: string[];
      metadataProvenance: Record<string, string | undefined>;
    };
    expect(apiWork.tags).toEqual(['Zeta Alpha', 'Zeta Beta']);
    expect(apiWork.metadataProvenance).toEqual({ tags: 'extracted' });

    const tagRows = await db
      .select({ name: tagTable.name, provenance: readingWorkTagTable.provenance })
      .from(readingWorkTagTable)
      .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
      .where(eq(readingWorkTagTable.workId, workId))
      .orderBy(tagTable.name);
    expect(tagRows).toEqual([
      { name: 'Zeta Alpha', provenance: 'extracted' },
      { name: 'Zeta Beta', provenance: 'extracted' },
    ]);

    // Extracted tags are recorded with origin='extracted' on the dimension row.
    const extractedOrigins = await db
      .select({ origin: tagTable.origin })
      .from(tagTable)
      .where(inArray(tagTable.name, ['Zeta Alpha', 'Zeta Beta']));
    expect(extractedOrigins.map((row) => row.origin)).toEqual(['extracted', 'extracted']);

    const sourceRows = await db.select().from(readingWorkSourceTable).where(eq(readingWorkSourceTable.workId, workId));
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]!.sourceId).toBe(testSourceId);
    expect(sourceRows[0]!.provenance).toBe('extracted');
  });

  it('cleans LCSH subjects into short product tags (never stores the catalog string)', async () => {
    const workId = await uploadAndFill(
      await buildEpubBytes({
        title: 'Aesop LCSH Book',
        subjects: ['Fables, Greek -- Translations into English'],
        chapters: [
          { href: 'chapter-1.xhtml', tocLabel: 'Chapter 1', content: '<html><body><p>Body.</p></body></html>' },
        ],
      }),
    );

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    const parsed = work!.originMeta.parsed as { subjects?: string[] };
    expect(parsed.subjects).toEqual(['Fables, Greek -- Translations into English']);

    const tagNames = await db
      .select({ name: tagTable.name })
      .from(readingWorkTagTable)
      .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
      .where(eq(readingWorkTagTable.workId, workId))
      .orderBy(tagTable.name);
    expect(tagNames.map((row) => row.name)).toEqual(['Fables', 'Greek']);
  });

  it('is idempotent: re-running fill keeps exactly one extracted association', async () => {
    const workId = await uploadAndFill(
      await buildEpubBytes({
        title: 'Idempotent Book',
        subjects: ['Science'],
        chapters: [{ href: 'chapter-1.xhtml', content: '<html><body><p>Body.</p></body></html>' }],
      }),
    );

    await fillWorkMetadata(workId);
    await fillWorkMetadata(workId);

    const tagRows = await db.select().from(readingWorkTagTable).where(eq(readingWorkTagTable.workId, workId));
    expect(tagRows).toHaveLength(1);
    expect(tagRows[0]!.provenance).toBe('extracted');
  });

  it('manual tags/sources from updateWork survive re-fill (junction SSOT)', async () => {
    const workId = await uploadAndFill(
      await buildEpubBytes({
        title: 'Manual Book',
        subjects: ['Science'],
        sourceRaw: 'https://standardebooks.org/ebooks/manual-book',
        chapters: [{ href: 'chapter-1.xhtml', content: '<html><body><p>Body.</p></body></html>' }],
      }),
    );

    const patched = await patchWork(workId, {
      tags: ['Science', 'Manual Tag'],
      sources: ['Test Publisher'],
      description: 'A hand-written description that is long enough to count.',
    });
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as {
      tags: string[];
      sources: string[];
      metadataProvenance: Record<string, string | undefined>;
    };
    expect([...body.tags].sort()).toEqual(['Manual Tag', 'Science'].sort());
    expect([...(body.sources ?? [])].sort()).toEqual(['Standard Ebooks', 'Test Publisher'].sort());

    await fillWorkMetadata(workId);

    const tagNames = await db
      .select({ name: tagTable.name })
      .from(readingWorkTagTable)
      .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
      .where(eq(readingWorkTagTable.workId, workId))
      .orderBy(tagTable.name);
    expect(tagNames.map((row) => row.name).sort()).toEqual(['Manual Tag', 'Science'].sort());

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.description).toBe('A hand-written description that is long enough to count.');
    expect(work!.descriptionProvenance).toBe('manual');

    const detail = await app.request(`/api/admin/works/${workId}`, { headers: { Cookie: adminCookie } });
    const apiWork = (await detail.json()) as { metadataProvenance: Record<string, string | undefined> };
    expect(apiWork.metadataProvenance.description).toBe('manual');
    expect(apiWork.metadataProvenance.tags).toBe('manual');

    const manualRows = await db.select().from(readingWorkTagTable).where(eq(readingWorkTagTable.workId, workId));
    expect(manualRows).toHaveLength(2);

    const sourceRows = await db
      .select({ provenance: readingWorkSourceTable.provenance })
      .from(readingWorkSourceTable)
      .where(eq(readingWorkSourceTable.workId, workId))
      .orderBy(readingWorkSourceTable.sourceId);
    expect(sourceRows.map((r) => r.provenance).sort()).toEqual(['extracted', 'manual']);
  });

  it('re-fill preserves ai provenance for AI-filled description/tags (P1 regression)', async () => {
    const workId = await uploadAndFill(
      await buildEpubBytes({
        title: 'AI Book',
        subjects: ['Science'],
        chapters: [{ href: 'chapter-1.xhtml', content: '<html><body><p>Body.</p></body></html>' }],
      }),
    );

    // Simulate a completed AI backfill: AI description + AI tag association
    // (distinct tag name — a same-name association would be deduped away).
    await db
      .update(readingWorkTable)
      .set({
        description: 'An AI written description that is long enough and clearly differs from extraction.',
        descriptionProvenance: 'ai',
      })
      .where(eq(readingWorkTable.id, workId));
    await db
      .insert(tagTable)
      .values({ id: 'tag-ai-provenance', name: 'AI Tag', normalized: 'aitag' })
      .onConflictDoNothing();
    createdTagIds.push('tag-ai-provenance');
    const [aiRow] = await db.select({ id: tagTable.id }).from(tagTable).where(eq(tagTable.name, 'AI Tag'));
    await db.insert(readingWorkTagTable).values({ workId, tagId: aiRow!.id, provenance: 'ai' }).onConflictDoNothing();

    await fillWorkMetadata(workId);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.description).toBe(
      'An AI written description that is long enough and clearly differs from extraction.',
    );
    expect(work!.descriptionProvenance).toBe('ai');

    const aiTagRows = await db
      .select({ provenance: readingWorkTagTable.provenance })
      .from(readingWorkTagTable)
      .where(eq(readingWorkTagTable.workId, workId));
    expect(aiTagRows.some((row) => row.provenance === 'ai')).toBe(true);
  });

  it('updateWork sets/clears category with manual provenance', async () => {
    const workId = await uploadAndFill(
      await buildEpubBytes({
        title: 'Category Book',
        chapters: [{ href: 'chapter-1.xhtml', content: '<html><body><p>Body.</p></body></html>' }],
      }),
    );

    const setResponse = await patchWork(workId, { category: 'Science Fiction' });
    expect(setResponse.status).toBe(200);
    const setBody = (await setResponse.json()) as {
      category: string | null;
      metadataProvenance: Record<string, string | undefined>;
    };
    expect(setBody.category).toBe('Science Fiction');
    expect(setBody.metadataProvenance.category).toBe('manual');

    const clearResponse = await patchWork(workId, { category: '' });
    expect(clearResponse.status).toBe(200);
    const clearBody = (await clearResponse.json()) as {
      category: string | null;
      metadataProvenance: Record<string, string | undefined>;
    };
    expect(clearBody.category).toBeNull();
    expect(clearBody.metadataProvenance.category).toBeUndefined();

    const rows = await db.select().from(readingWorkCategoryTable).where(eq(readingWorkCategoryTable.workId, workId));
    expect(rows).toHaveLength(0);
  });

  it('clears manual associations when the patch omits them (manual-only scope)', async () => {
    const workId = await uploadAndFill(
      await buildEpubBytes({
        title: 'Clear Book',
        subjects: ['Science'],
        chapters: [{ href: 'chapter-1.xhtml', content: '<html><body><p>Body.</p></body></html>' }],
      }),
    );
    await patchWork(workId, { tags: ['Temporary'], sources: ['Temp Source'] });

    const cleared = await patchWork(workId, { tags: [], sources: [] });
    expect(cleared.status).toBe(200);
    const body = (await cleared.json()) as { tags: string[]; sources: string[] };
    expect(body.tags).toEqual(['Science']);
    expect(body.sources).toEqual([]);

    const tagNames = await db
      .select({ name: tagTable.name })
      .from(readingWorkTagTable)
      .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
      .where(eq(readingWorkTagTable.workId, workId))
      .orderBy(tagTable.name);
    expect(tagNames.map((row) => row.name)).toEqual(['Science']);
  });

  it('retry resumes a failed metadata step (no body → failedStep)', async () => {
    const workId = await uploadAndFill(
      await buildEpubBytes({
        title: 'Retry Fill Book',
        chapters: [{ href: 'chapter-1.xhtml', content: '<html><body><p>Body.</p></body></html>' }],
      }),
    );
    await db
      .update(readingWorkTable)
      .set({ status: 'failed', originMeta: { failedStep: 'metadata', lastError: 'boom' } })
      .where(eq(readingWorkTable.id, workId));

    const response = await app.request(`/api/admin/works/${workId}/workflow/retry`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; failedStep: string | null };
    expect(body.status).toBe('metadata');
    expect(body.failedStep).toBeNull();

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.status).toBe('metadata');
    expect(work!.originMeta.lastError).toBeUndefined();
  });

  it('keeps an active claim exclusive and lets a new attempt recover an expired lease', async () => {
    const workId = await uploadAndFill(
      await buildEpubBytes({
        title: 'Workflow Lease Book',
        chapters: [{ href: 'chapter-1.xhtml', content: '<html><body><p>Body.</p></body></html>' }],
      }),
    );
    const retryJobToken = `retry-${workId}`;
    await db
      .update(readingWorkTable)
      .set({
        status: 'processing',
        originMeta: {
          retryJobToken,
          workflowClaimAttempt: 'attempt-a',
          workflowClaimStep: 'parse',
          workflowClaimLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      })
      .where(eq(readingWorkTable.id, workId));

    expect(await claimWorkflowStep(workId, 'parse', retryJobToken, 'attempt-b')).toBe(false);
    await db
      .update(readingWorkTable)
      .set({
        originMeta: {
          retryJobToken,
          workflowClaimAttempt: 'attempt-a',
          workflowClaimStep: 'parse',
          workflowClaimLeaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
        },
      })
      .where(eq(readingWorkTable.id, workId));

    expect(await claimWorkflowStep(workId, 'parse', retryJobToken, 'attempt-b')).toBe(true);
    expect(
      await completeWorkflowStep(workId, 'ready', undefined, 'processing', retryJobToken, 'parse', 'attempt-a'),
    ).toBe(false);
    expect(await failWorkflowStep(workId, 'parse', retryJobToken, 'attempt-a', new Error('stale'))).toBe(false);
    expect(
      await completeWorkflowStep(workId, 'ready', undefined, 'processing', retryJobToken, 'parse', 'attempt-b'),
    ).toBe(true);
  });

  it('refuses workflow retry for non-EPUB works', async () => {
    const created = await app.request('/api/admin/works', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Text Retry Book', body: '<p>Body.</p>' }),
    });
    expect(created.status).toBe(201);
    const work = (await created.json()) as { id: string };
    createdWorkIds.push(work.id);

    const response = await app.request(`/api/admin/works/${work.id}/workflow/retry`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(response.status).toBe(400);
  });
});
