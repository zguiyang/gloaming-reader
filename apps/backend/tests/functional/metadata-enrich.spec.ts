import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  category as categoryTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkTag as readingWorkTagTable,
  tag as tagTable,
  uploadedObject as uploadedObjectTable,
  user as userTable,
} from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { processMetadataEnrich } from '@/jobs/metadata-enrich';
import { AppError } from '@/lib/errors';
import { normalizeTag } from '@/lib/text';
import { claimWorkflowStep, rotateWorkflowJobToken } from '@/lib/workflow';
import { processContentWork } from '@/modules/content-parser';
import { enrichWorkMetadata } from '@/modules/metadata-enrich/service';
import { listCategoriesTool, listExistingTagsTool } from '@/modules/metadata-enrich/tools';
import { fillWorkMetadata } from '@/modules/metadata-fill/service';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/modules/oss';
import { hashFileContent } from '@/modules/uploads/service';

import { buildEpubBytes } from '../helpers/epub-builder';
import { createMemoryObjectStore } from '../helpers/memory-oss';

const { invokeAiMock } = vi.hoisted(() => ({ invokeAiMock: vi.fn() }));

vi.mock('@/modules/ai', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, invokeAi: invokeAiMock };
});

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

describe('metadata-enrich AI backfill (invokeAi mocked)', () => {
  const memory = createMemoryObjectStore();
  const createdWorkIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdContentHashes: string[] = [];
  const createdTagIds: string[] = [];
  let adminCookie = '';

  /** Categories are no longer seeded (0020) — create on demand for fixtures. */
  async function ensureCategory(name: string): Promise<string> {
    const existing = await db
      .select({ id: categoryTable.id })
      .from(categoryTable)
      .where(eq(categoryTable.name, name))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const [row] = await db
      .insert(categoryTable)
      .values({
        id: `cat-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        normalized: normalizeTag(name),
      })
      .returning({ id: categoryTable.id });
    createdCategoryIds.push(row!.id);
    return row!.id;
  }

  const chapter = {
    href: 'chapter-1.xhtml',
    tocLabel: 'Chapter 1',
    content:
      '<html xmlns="http://www.w3.org/1999/xhtml"><body>' +
      '<h1>Chapter 1</h1>' +
      '<p>' +
      'word '.repeat(120) +
      '</p>' +
      '</body></html>',
  };

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
  });

  afterAll(async () => {
    for (const workId of createdWorkIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
    await db.delete(categoryTable).where(inArray(categoryTable.id, createdCategoryIds));
    if (createdContentHashes.length > 0) {
      await db.delete(uploadedObjectTable).where(inArray(uploadedObjectTable.contentHash, createdContentHashes));
    }
    if (createdTagIds.length > 0) {
      await db.delete(tagTable).where(inArray(tagTable.id, createdTagIds));
    }
    resetObjectStoreCache();
  });

  async function createParsedWork(input: {
    title: string;
    description?: string;
    subjects?: string[];
  }): Promise<string> {
    const bytes = await buildEpubBytes({ title: input.title, chapters: [chapter], ...input });
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
    const [parsed] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.id));
    const fillRetryJobToken = parsed!.originMeta.retryJobToken as string;
    const fillAttemptToken = randomUUID();
    const enrichRetryJobToken = randomUUID();
    const enrichEnqueueAttemptToken = randomUUID();
    expect(await claimWorkflowStep(created.id, 'metadata', fillRetryJobToken, fillAttemptToken)).toBe(true);
    await fillWorkMetadata(created.id);
    expect(
      await rotateWorkflowJobToken(
        created.id,
        'metadata',
        'metadata',
        fillRetryJobToken,
        fillAttemptToken,
        enrichRetryJobToken,
        enrichEnqueueAttemptToken,
        'metadata',
        'metadata',
      ),
    ).toBe(true);
    return created.id;
  }

  async function fetchAdminWork(workId: string) {
    const response = await app.request(`/api/admin/works/${workId}`, { headers: { Cookie: adminCookie } });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      tags: string[];
      metadataProvenance: Record<string, string | undefined>;
    };
  }

  beforeEach(() => {
    invokeAiMock.mockReset();
    invokeAiMock.mockResolvedValue({
      content: {},
      model: { rowId: 'row', label: 'mock', modelId: 'mock-model' },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
  });

  it('short-circuits with completed when nothing needs AI (zero cost)', async () => {
    const workId = await createParsedWork({
      title: 'Complete Book',
      description:
        'A fully written description with plenty of detail to be useful for readers browsing the catalog shelf.',
      subjects: ['Science'],
    });
    const categoryId = await ensureCategory('Science');
    await db.insert(readingWorkCategoryTable).values({ workId, categoryId, provenance: 'extracted' });

    await enrichWorkMetadata(workId);

    expect(invokeAiMock).not.toHaveBeenCalled();
    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.status).toBe('ready');
  });

  it('treats catalog-like extracted tags as weak and overwrites them with AI tags', async () => {
    const workId = await createParsedWork({
      title: 'LCSH Legacy Book',
      description:
        'A fully written description with plenty of detail to be useful for readers browsing the catalog shelf.',
    });
    const lcshName = 'Fables, Greek -- Translations into English';
    await db
      .insert(tagTable)
      .values({
        id: 'tag-lcsh-legacy',
        name: lcshName,
        normalized: normalizeTag(lcshName),
        origin: 'extracted',
      })
      .onConflictDoNothing();
    createdTagIds.push('tag-lcsh-legacy');
    const [lcshTag] = await db.select({ id: tagTable.id }).from(tagTable).where(eq(tagTable.name, lcshName));
    await db.delete(readingWorkTagTable).where(eq(readingWorkTagTable.workId, workId));
    await db
      .insert(readingWorkTagTable)
      .values({ workId, tagId: lcshTag!.id, provenance: 'extracted' })
      .onConflictDoNothing();
    await db.update(readingWorkTable).set({ status: 'metadata' }).where(eq(readingWorkTable.id, workId));

    invokeAiMock.mockResolvedValueOnce({
      content: {
        tags: [
          { kind: 'new', name: 'Fables' },
          { kind: 'new', name: 'Morality' },
        ],
        category: { kind: 'new', name: 'Folklore' },
      },
      model: { rowId: 'row', label: 'mock', modelId: 'mock-model' },
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    });

    await enrichWorkMetadata(workId);

    expect(invokeAiMock).toHaveBeenCalledTimes(1);
    const invokeArgs = invokeAiMock.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
      requestSummaryExtra: { neededFields: string };
    };
    expect(invokeArgs.requestSummaryExtra.neededFields.split(',')).toEqual(
      expect.arrayContaining(['tags', 'category']),
    );

    const apiWork = await fetchAdminWork(workId);
    expect([...apiWork.tags].sort()).toEqual(['Fables', 'Morality']);
    expect(apiWork.metadataProvenance.tags).toBe('ai');
    expect(apiWork.tags).not.toContain(lcshName);

    const provenances = await db
      .select({ provenance: readingWorkTagTable.provenance })
      .from(readingWorkTagTable)
      .where(eq(readingWorkTagTable.workId, workId));
    expect(provenances.every((row) => row.provenance === 'ai')).toBe(true);
  });

  it('fills empty/weak fields with ai provenance via junction SSOT', async () => {
    const workId = await createParsedWork({ title: 'Fill Book' });

    invokeAiMock.mockResolvedValueOnce({
      content: {
        description: 'An AI written summary of the book.',
        tags: [
          { kind: 'new', name: 'Space' },
          { kind: 'new', name: 'Adventure' },
        ],
        category: { kind: 'new', name: 'Zeta Fiction' },
      },
      model: { rowId: 'row', label: 'mock', modelId: 'mock-model' },
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    });

    await enrichWorkMetadata(workId);

    expect(invokeAiMock).toHaveBeenCalledTimes(1);
    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.status).toBe('ready');
    expect(work!.description).toBe('An AI written summary of the book.');
    expect(work!.descriptionProvenance).toBe('ai');

    const tagRows = await db
      .select({ provenance: readingWorkTagTable.provenance })
      .from(readingWorkTagTable)
      .where(eq(readingWorkTagTable.workId, workId));
    expect(tagRows.map((r) => r.provenance)).toEqual(['ai', 'ai']);

    const apiWork = await fetchAdminWork(workId);
    expect(apiWork.metadataProvenance).toMatchObject({ description: 'ai', tags: 'ai', category: 'ai' });
    expect([...apiWork.tags].sort()).toEqual(['Adventure', 'Space']);

    // AI-created tags are recorded as origin='ai' on the dimension row.
    const [spaceTag] = await db
      .select({ origin: tagTable.origin })
      .from(tagTable)
      .where(eq(tagTable.name, 'Space'))
      .limit(1);
    expect(spaceTag?.origin).toBe('ai');

    const categoryRows = await db
      .select({ provenance: readingWorkCategoryTable.provenance })
      .from(readingWorkCategoryTable)
      .where(eq(readingWorkCategoryTable.workId, workId));
    expect(categoryRows).toHaveLength(1);
    expect(categoryRows[0]!.provenance).toBe('ai');

    // No existing category matched — the AI-created one lands with origin='ai'.
    const [createdCategory] = await db
      .select({ origin: categoryTable.origin, name: categoryTable.name })
      .from(categoryTable)
      .where(eq(categoryTable.name, 'Zeta Fiction'))
      .limit(1);
    expect(createdCategory?.origin).toBe('ai');
  });

  it('reuses existing dimensions when the model returns existing ids', async () => {
    const workId = await createParsedWork({ title: 'Reuse Book' });
    await db
      .insert(tagTable)
      .values({ id: 'tag-reuse-fixture', name: 'Reuse Tag', normalized: 'reusetag', origin: 'manual' })
      .onConflictDoNothing();
    createdTagIds.push('tag-reuse-fixture');
    const categoryId = await ensureCategory('Reuse Category');

    invokeAiMock.mockResolvedValueOnce({
      content: {
        tags: [{ kind: 'existing', id: 'tag-reuse-fixture', name: 'Reuse Tag' }],
        category: { kind: 'existing', id: categoryId, name: 'Reuse Category' },
      },
      model: { rowId: 'row', label: 'mock', modelId: 'mock-model' },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });

    await enrichWorkMetadata(workId);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.status).toBe('ready');

    const apiWork = await fetchAdminWork(workId);
    expect(apiWork.tags).toEqual(['Reuse Tag']);
    expect(apiWork.metadataProvenance.tags).toBe('ai');

    // Reused rows keep their original creator — no origin rewrite, no dupes.
    const [tag] = await db
      .select({ origin: tagTable.origin })
      .from(tagTable)
      .where(eq(tagTable.id, 'tag-reuse-fixture'));
    expect(tag?.origin).toBe('manual');
    const [category] = await db
      .select({ origin: categoryTable.origin })
      .from(categoryTable)
      .where(eq(categoryTable.id, categoryId));
    expect(category?.origin).toBe('manual');

    const rows = await db.select().from(readingWorkTagTable).where(eq(readingWorkTagTable.workId, workId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tagId).toBe('tag-reuse-fixture');
  });

  it('falls back to creating when an existing id is invalid', async () => {
    const workId = await createParsedWork({ title: 'Ghost Id Book' });

    invokeAiMock.mockResolvedValueOnce({
      content: {
        tags: [{ kind: 'existing', id: 'no-such-tag', name: 'Ghost Tag' }],
        category: { kind: 'existing', id: 'no-such-cat', name: 'Ghost Category' },
      },
      model: { rowId: 'row', label: 'mock', modelId: 'mock-model' },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });

    await enrichWorkMetadata(workId);

    const [tag] = await db
      .select({ origin: tagTable.origin })
      .from(tagTable)
      .where(eq(tagTable.name, 'Ghost Tag'))
      .limit(1);
    expect(tag?.origin).toBe('ai');
    const [category] = await db
      .select({ origin: categoryTable.origin })
      .from(categoryTable)
      .where(eq(categoryTable.name, 'Ghost Category'))
      .limit(1);
    expect(category?.origin).toBe('ai');
  });

  it('sends an output schema containing only the required fields', async () => {
    const workId = await createParsedWork({ title: 'Schema Book' });

    await app.request(`/api/admin/works/${workId}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'A solid hand-written description that is long enough for the manual requirement.',
        tags: ['Manual Tag'],
      }),
    });

    invokeAiMock.mockResolvedValueOnce({
      content: { category: { kind: 'new', name: 'Schema Category' } },
      model: { rowId: 'row', label: 'mock', modelId: 'mock-model' },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });

    await enrichWorkMetadata(workId);

    const invokeArgs = invokeAiMock.mock.calls[0]![0] as { outputSchema: { shape: Record<string, unknown> } };
    expect(Object.keys(invokeArgs.outputSchema.shape)).toEqual(['category']);

    const categoryRows = await db
      .select({ provenance: readingWorkCategoryTable.provenance })
      .from(readingWorkCategoryTable)
      .where(eq(readingWorkCategoryTable.workId, workId));
    expect(categoryRows[0]!.provenance).toBe('ai');

    const apiWork = await fetchAdminWork(workId);
    expect(apiWork.metadataProvenance.category).toBe('ai');
  });

  it('does not override manual values and skips works outside the metadata step', async () => {
    const workId = await createParsedWork({ title: 'Manual Fill Book', subjects: ['Science'] });

    await app.request(`/api/admin/works/${workId}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tags: ['Manual Tag'],
        description: 'A solid hand-written description that is long enough.',
      }),
    });

    await enrichWorkMetadata(workId);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.description).toBe('A solid hand-written description that is long enough.');
    expect(work!.descriptionProvenance).toBe('manual');

    const apiWork = await fetchAdminWork(workId);
    expect(apiWork.metadataProvenance.description).toBe('manual');
    expect(apiWork.tags).toContain('Manual Tag');

    // Second run on a completed work must not invoke the model again.
    const callsAfterFirst = invokeAiMock.mock.calls.length;
    await enrichWorkMetadata(workId);
    expect(invokeAiMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('degrades to skipped when the model is not configured (503)', async () => {
    const workId = await createParsedWork({ title: 'No Model Book' });

    invokeAiMock.mockRejectedValueOnce(
      new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'Metadata enrich model not configured'),
    );

    await enrichWorkMetadata(workId);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.status).toBe('ready');
  });

  it('does not degrade generic AI 503s (e.g. bad JSON) into a successful ready step', async () => {
    const workId = await createParsedWork({ title: 'Bad Json Book' });

    invokeAiMock.mockRejectedValueOnce(
      new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'Unexpected token \'d\', "descriptio"... is not valid JSON'),
    );

    await expect(enrichWorkMetadata(workId)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
    });

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.status).toBe('metadata');
  });

  it('restores the failed step so the bounded retry can re-claim (at-least-once)', async () => {
    const workId = await createParsedWork({ title: 'Retry Book' });
    const [prepared] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    const retryJobToken = prepared!.originMeta.retryJobToken as string;
    const firstAttemptToken = randomUUID();
    const retryAttemptToken = randomUUID();

    invokeAiMock.mockRejectedValueOnce(new Error('upstream boom'));

    await expect(processMetadataEnrich({ workId, retryJobToken }, firstAttemptToken)).rejects.toThrow('upstream boom');

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.status).toBe('failed');
    expect(work!.originMeta.failedStep).toBe('metadata');
    expect(work!.originMeta.workflowClaimAttempt).toBeUndefined();

    let retryClaimAttempt: unknown;
    invokeAiMock.mockImplementationOnce(async () => {
      const [claimed] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
      retryClaimAttempt = claimed!.originMeta.workflowClaimAttempt;
      return {
        content: { description: 'Recovered on retry.' },
        model: { rowId: 'row', label: 'mock', modelId: 'mock-model' },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    });
    await processMetadataEnrich({ workId, retryJobToken }, retryAttemptToken);

    const [after] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(after!.status).toBe('ready');
    expect(after!.description).toBe('Recovered on retry.');
    expect(retryClaimAttempt).toBe(retryAttemptToken);
    expect(retryClaimAttempt).not.toBe(firstAttemptToken);
  });

  it('list_existing_tags returns top-N by usage and searches by normalized name', async () => {
    await createParsedWork({ title: 'Tool Book', subjects: ['Science', 'Adventure'] });

    const top = await listExistingTagsTool().invoke({});
    const parsedTop = JSON.parse(top) as { tags: Array<{ name: string; usage: number }> };
    expect(parsedTop.tags.length).toBeGreaterThanOrEqual(2);
    expect(parsedTop.tags.some((t) => t.name === 'Science')).toBe(true);

    const searched = await listExistingTagsTool().invoke({ query: 'adventure' });
    const parsedSearch = JSON.parse(searched) as { tags: Array<{ name: string; usage: number }> };
    expect(parsedSearch.tags.map((t) => t.name)).toContain('Adventure');
  });

  it('list_categories returns the admin-managed enumeration with ids', async () => {
    await ensureCategory('Mystery');
    const raw = await listCategoriesTool().invoke({});
    const parsed = JSON.parse(raw) as { categories: Array<{ id: string; name: string }> };
    expect(parsed.categories.some((c) => c.name === 'Mystery')).toBe(true);
    expect(parsed.categories.every((c) => Boolean(c.id))).toBe(true);
  });
});
