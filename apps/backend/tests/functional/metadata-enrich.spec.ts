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
  verification as verificationTable,
} from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
import type { TaxonomyReference } from '@gloaming/shared/taxonomy';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { processMetadataEnrich } from '@/jobs/metadata-enrich';
import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
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

const { invokeAiMock, sendAuthMailMock } = vi.hoisted(() => ({
  invokeAiMock: vi.fn(),
  sendAuthMailMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/ai', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, invokeAi: invokeAiMock };
});

vi.mock('@/lib/auth/mail', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendAuthMail: sendAuthMailMock };
});

import app from '@/app';

const password = 'password123';

describe('metadata-enrich AI backfill (invokeAi mocked)', () => {
  const suiteRunId = randomUUID();
  const memory = createMemoryObjectStore();
  const createdWorkIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdContentHashes: string[] = [];
  const createdTagIds: string[] = [];
  let adminCookie = '';
  let adminEmail = '';

  function suiteLabel(fragment: string): string {
    return `metadata-enrich-${fragment}-${suiteRunId}`;
  }

  function suiteTagId(fragment: string): string {
    return `tag-me-${fragment}-${suiteRunId}`;
  }

  function suiteCategoryId(): string {
    return `cat-me-${randomUUID()}`;
  }

  function trackTagId(id: string) {
    if (!createdTagIds.includes(id)) {
      createdTagIds.push(id);
    }
  }

  function trackCategoryId(id: string) {
    if (!createdCategoryIds.includes(id)) {
      createdCategoryIds.push(id);
    }
  }

  /** Always inserts a new category row for this suite — never reuses or updates existing rows. */
  async function ensureCategory(name: string): Promise<string> {
    const [row] = await db
      .insert(categoryTable)
      .values({
        id: suiteCategoryId(),
        name,
        normalized: normalizeTag(name),
      })
      .returning({ id: categoryTable.id });
    trackCategoryId(row!.id);
    return row!.id;
  }

  async function insertOwnedTag(values: {
    id?: string;
    name: string;
    normalized: string;
    localizedNames?: Record<string, string>;
    origin: 'manual' | 'extracted' | 'ai';
  }): Promise<string> {
    const id = values.id ?? suiteTagId(randomUUID().slice(0, 8));
    const [row] = await db
      .insert(tagTable)
      .values({
        id,
        name: values.name,
        normalized: values.normalized,
        localizedNames: values.localizedNames,
        origin: values.origin,
      })
      .returning({ id: tagTable.id });
    trackTagId(row!.id);
    return row!.id;
  }

  /** Inserts a tag fixture; only tracks ids when the row was actually inserted. */
  async function insertTagFixtureIfAbsent(values: {
    id: string;
    name: string;
    normalized: string;
    localizedNames?: Record<string, string>;
    origin: 'manual' | 'extracted' | 'ai';
  }): Promise<string> {
    const inserted = await db.insert(tagTable).values(values).onConflictDoNothing().returning({ id: tagTable.id });
    if (inserted[0]) {
      trackTagId(inserted[0].id);
      return inserted[0].id;
    }
    const [existing] = await db.select({ id: tagTable.id }).from(tagTable).where(eq(tagTable.id, values.id)).limit(1);
    if (!existing) {
      throw new Error(`Expected tag fixture ${values.id} to exist after conflict`);
    }
    return existing.id;
  }

  async function trackCreatedTaxonomyByNames(names: { tags?: string[]; categories?: string[] }) {
    for (const name of names.tags ?? []) {
      const [row] = await db.select({ id: tagTable.id }).from(tagTable).where(eq(tagTable.name, name)).limit(1);
      if (row) trackTagId(row.id);
    }
    for (const name of names.categories ?? []) {
      const [row] = await db
        .select({ id: categoryTable.id })
        .from(categoryTable)
        .where(eq(categoryTable.name, name))
        .limit(1);
      if (row) trackCategoryId(row.id);
    }
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
    adminEmail = `admin-${suiteRunId}@example.com`;
    const username = `admin_${suiteRunId.replace(/-/g, '').slice(0, 12)}`;
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: adminEmail, password, name: 'admin', username }),
    });
    await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, adminEmail));
    await db.update(userTable).set({ role: AUTH_ADMIN_ROLE }).where(eq(userTable.email, adminEmail));
    const login = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: adminEmail, password }),
    });
    adminCookie = cookieHeader(login);
  });

  afterAll(async () => {
    for (const workId of createdWorkIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
    if (createdCategoryIds.length > 0) {
      await db.delete(categoryTable).where(inArray(categoryTable.id, createdCategoryIds));
    }
    if (createdContentHashes.length > 0) {
      await db.delete(uploadedObjectTable).where(inArray(uploadedObjectTable.contentHash, createdContentHashes));
    }
    if (createdTagIds.length > 0) {
      await db.delete(tagTable).where(inArray(tagTable.id, createdTagIds));
    }
    if (adminEmail) {
      const [adminUser] = await db
        .select({ id: userTable.id })
        .from(userTable)
        .where(eq(userTable.email, adminEmail))
        .limit(1);
      if (adminUser) {
        await db.delete(verificationTable).where(eq(verificationTable.value, adminUser.id));
      }
      await db.delete(userTable).where(eq(userTable.email, adminEmail));
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
      tags: TaxonomyReference[];
      metadataProvenance: Record<string, string | undefined>;
    };
  }

  function tagLabels(tags: TaxonomyReference[]): string[] {
    return tags.map((tag) => tag.names['en-US'] ?? tag.names['zh-CN'] ?? '');
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
    const categoryDisplayName = suiteLabel('complete-category');
    const tagDisplayName = suiteLabel('complete-tag');
    const workId = await createParsedWork({
      title: suiteLabel('Complete Book'),
      description:
        'A fully written description with plenty of detail to be useful for readers browsing the catalog shelf.',
      subjects: [suiteLabel('complete-subject')],
    });
    const categoryId = await ensureCategory(categoryDisplayName);
    await db
      .update(categoryTable)
      .set({
        localizedNames: { 'zh-CN': suiteLabel('complete-category-zh'), 'en-US': categoryDisplayName },
        origin: 'manual',
      })
      .where(eq(categoryTable.id, categoryId));
    await db.insert(readingWorkCategoryTable).values({ workId, categoryId, provenance: 'manual' });
    const tagId = await insertOwnedTag({
      name: tagDisplayName,
      normalized: normalizeTag(tagDisplayName),
      localizedNames: { 'zh-CN': suiteLabel('complete-tag-zh'), 'en-US': tagDisplayName },
      origin: 'manual',
    });
    await db.insert(readingWorkTagTable).values({ workId, tagId, provenance: 'manual' });

    await enrichWorkMetadata(workId);

    expect(invokeAiMock).not.toHaveBeenCalled();
    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.status).toBe('ready');
  });

  it('treats catalog-like extracted tags as weak and overwrites them with AI tags', async () => {
    const workId = await createParsedWork({
      title: suiteLabel('LCSH Legacy Book'),
      description:
        'A fully written description with plenty of detail to be useful for readers browsing the catalog shelf.',
    });
    const lcshName = suiteLabel('Fables, Greek -- Translations into English');
    const lcshTagId = suiteTagId('lcsh-legacy');
    const lcshTagRowId = await insertTagFixtureIfAbsent({
      id: lcshTagId,
      name: lcshName,
      normalized: normalizeTag(lcshName),
      origin: 'extracted',
    });
    await db.delete(readingWorkTagTable).where(eq(readingWorkTagTable.workId, workId));
    await db
      .insert(readingWorkTagTable)
      .values({ workId, tagId: lcshTagRowId, provenance: 'extracted' })
      .onConflictDoNothing();
    await db.update(readingWorkTable).set({ status: 'metadata' }).where(eq(readingWorkTable.id, workId));

    const fablesName = suiteLabel('Fables');
    const moralityName = suiteLabel('Morality');
    const folkloreCategoryName = suiteLabel('Folklore');

    invokeAiMock.mockResolvedValueOnce({
      content: {
        tags: [
          { id: null, name: fablesName },
          { id: null, name: moralityName },
        ],
        category: { id: null, name: folkloreCategoryName },
      },
      model: { rowId: 'row', label: 'mock', modelId: 'mock-model' },
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    });

    await enrichWorkMetadata(workId);
    await trackCreatedTaxonomyByNames({
      tags: [fablesName, moralityName],
      categories: [folkloreCategoryName],
    });

    expect(invokeAiMock).toHaveBeenCalledTimes(1);
    const invokeArgs = invokeAiMock.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
      requestSummaryExtra: { neededFields: string };
    };
    expect(invokeArgs.requestSummaryExtra.neededFields.split(',')).toEqual(
      expect.arrayContaining(['tags', 'category']),
    );

    const apiWork = await fetchAdminWork(workId);
    expect(tagLabels(apiWork.tags).sort()).toEqual([fablesName, moralityName].sort());
    expect(apiWork.metadataProvenance.tags).toBe('ai');
    expect(tagLabels(apiWork.tags)).not.toContain(lcshName);

    const provenances = await db
      .select({ provenance: readingWorkTagTable.provenance })
      .from(readingWorkTagTable)
      .where(eq(readingWorkTagTable.workId, workId));
    expect(provenances.every((row) => row.provenance === 'ai')).toBe(true);
  });

  it('fills empty/weak fields with ai provenance via junction SSOT', async () => {
    const workId = await createParsedWork({ title: suiteLabel('Fill Book') });
    const spaceName = suiteLabel('Space');
    const adventureName = suiteLabel('Adventure');
    const zetaFictionName = suiteLabel('Zeta Fiction');

    invokeAiMock.mockResolvedValueOnce({
      content: {
        description: 'An AI written summary of the book.',
        tags: [
          { id: null, name: spaceName },
          { id: null, name: adventureName },
        ],
        category: { id: null, name: zetaFictionName },
      },
      model: { rowId: 'row', label: 'mock', modelId: 'mock-model' },
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    });

    await enrichWorkMetadata(workId);
    await trackCreatedTaxonomyByNames({
      tags: [spaceName, adventureName],
      categories: [zetaFictionName],
    });

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
    expect(tagLabels(apiWork.tags).sort()).toEqual([adventureName, spaceName].sort());

    const [spaceTag] = await db
      .select({ origin: tagTable.origin })
      .from(tagTable)
      .where(eq(tagTable.name, spaceName))
      .limit(1);
    expect(spaceTag?.origin).toBe('ai');

    const categoryRows = await db
      .select({ provenance: readingWorkCategoryTable.provenance })
      .from(readingWorkCategoryTable)
      .where(eq(readingWorkCategoryTable.workId, workId));
    expect(categoryRows).toHaveLength(1);
    expect(categoryRows[0]!.provenance).toBe('ai');

    const [createdCategory] = await db
      .select({ origin: categoryTable.origin, name: categoryTable.name })
      .from(categoryTable)
      .where(eq(categoryTable.name, zetaFictionName))
      .limit(1);
    expect(createdCategory?.origin).toBe('ai');
  });

  it('reuses existing dimensions when the model returns existing ids', async () => {
    const workId = await createParsedWork({ title: suiteLabel('Reuse Book') });
    const reuseTagId = suiteTagId('reuse-fixture');
    const reuseTagName = suiteLabel('Reuse Tag');
    const reuseCategoryName = suiteLabel('Reuse Category');
    await insertTagFixtureIfAbsent({
      id: reuseTagId,
      name: reuseTagName,
      normalized: normalizeTag(reuseTagName),
      origin: 'manual',
    });
    const categoryId = await ensureCategory(reuseCategoryName);

    invokeAiMock.mockResolvedValueOnce({
      content: {
        tags: [{ id: reuseTagId, name: reuseTagName }],
        category: { id: categoryId, name: reuseCategoryName },
      },
      model: { rowId: 'row', label: 'mock', modelId: 'mock-model' },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });

    await enrichWorkMetadata(workId);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.status).toBe('ready');

    const apiWork = await fetchAdminWork(workId);
    expect(tagLabels(apiWork.tags)).toEqual([reuseTagName]);
    expect(apiWork.metadataProvenance.tags).toBe('ai');

    const [tag] = await db.select({ origin: tagTable.origin }).from(tagTable).where(eq(tagTable.id, reuseTagId));
    expect(tag?.origin).toBe('manual');
    const [category] = await db
      .select({ origin: categoryTable.origin })
      .from(categoryTable)
      .where(eq(categoryTable.id, categoryId));
    expect(category?.origin).toBe('manual');

    const rows = await db.select().from(readingWorkTagTable).where(eq(readingWorkTagTable.workId, workId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tagId).toBe(reuseTagId);
  });

  it('falls back to creating when an existing id is invalid', async () => {
    const workId = await createParsedWork({ title: suiteLabel('Ghost Id Book') });
    const ghostTagName = suiteLabel('Ghost Tag');
    const ghostCategoryName = suiteLabel('Ghost Category');

    invokeAiMock.mockResolvedValueOnce({
      content: {
        tags: [{ id: 'no-such-tag', name: ghostTagName }],
        category: { id: 'no-such-cat', name: ghostCategoryName },
      },
      model: { rowId: 'row', label: 'mock', modelId: 'mock-model' },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });

    await enrichWorkMetadata(workId);
    await trackCreatedTaxonomyByNames({ tags: [ghostTagName], categories: [ghostCategoryName] });

    const [tag] = await db
      .select({ origin: tagTable.origin })
      .from(tagTable)
      .where(eq(tagTable.name, ghostTagName))
      .limit(1);
    expect(tag?.origin).toBe('ai');
    const [category] = await db
      .select({ origin: categoryTable.origin })
      .from(categoryTable)
      .where(eq(categoryTable.name, ghostCategoryName))
      .limit(1);
    expect(category?.origin).toBe('ai');
  });

  it('sends an output schema containing only the required fields', async () => {
    const workId = await createParsedWork({ title: suiteLabel('Schema Book') });
    const schemaCategoryName = suiteLabel('Schema Category');

    const manualTagName = suiteLabel('Manual Fill Tag');
    const manualTagId = await insertOwnedTag({
      name: manualTagName,
      normalized: normalizeTag(manualTagName),
      localizedNames: { 'zh-CN': suiteLabel('manual-fill-tag-zh'), 'en-US': manualTagName },
      origin: 'manual',
    });

    await app.request(`/api/admin/works/${workId}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'A solid hand-written description that is long enough for the manual requirement.',
        tags: [{ id: manualTagId }],
      }),
    });

    invokeAiMock.mockResolvedValueOnce({
      content: { category: { id: null, name: schemaCategoryName } },
      model: { rowId: 'row', label: 'mock', modelId: 'mock-model' },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });

    await enrichWorkMetadata(workId);
    await trackCreatedTaxonomyByNames({ categories: [schemaCategoryName] });

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
    const workId = await createParsedWork({
      title: suiteLabel('Manual Fill Book'),
      subjects: [suiteLabel('manual-subject')],
    });

    const manualTagName = suiteLabel('Manual Tag');
    const manualTagId = await insertOwnedTag({
      name: manualTagName,
      normalized: normalizeTag(manualTagName),
      localizedNames: { 'zh-CN': suiteLabel('manual-tag-zh'), 'en-US': manualTagName },
      origin: 'manual',
    });

    await app.request(`/api/admin/works/${workId}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tags: [{ id: manualTagId }],
        description: 'A solid hand-written description that is long enough.',
      }),
    });

    await enrichWorkMetadata(workId);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.description).toBe('A solid hand-written description that is long enough.');
    expect(work!.descriptionProvenance).toBe('manual');

    const apiWork = await fetchAdminWork(workId);
    expect(apiWork.metadataProvenance.description).toBe('manual');
    expect(tagLabels(apiWork.tags)).toContain(manualTagName);

    const callsAfterFirst = invokeAiMock.mock.calls.length;
    await enrichWorkMetadata(workId);
    expect(invokeAiMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('degrades to skipped when the model is not configured (503)', async () => {
    const workId = await createParsedWork({ title: suiteLabel('No Model Book') });

    invokeAiMock.mockRejectedValueOnce(
      new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.MODEL_NOT_CONFIGURED),
    );

    await enrichWorkMetadata(workId);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.status).toBe('ready');
  });

  it('does not degrade generic AI 503s (e.g. bad JSON) into a successful ready step', async () => {
    const workId = await createParsedWork({ title: suiteLabel('Bad Json Book') });

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
    const workId = await createParsedWork({ title: suiteLabel('Retry Book') });
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
    const tagHighName = suiteLabel('tool-high');
    const tagLowName = suiteLabel('tool-low');
    const tagHighId = await insertOwnedTag({
      name: tagHighName,
      normalized: normalizeTag(tagHighName),
      origin: 'manual',
    });
    const tagLowId = await insertOwnedTag({
      name: tagLowName,
      normalized: normalizeTag(tagLowName),
      origin: 'manual',
    });

    const workIdA = await createParsedWork({ title: suiteLabel('Tool Book A') });
    const workIdB = await createParsedWork({ title: suiteLabel('Tool Book B') });
    await db
      .insert(readingWorkTagTable)
      .values({ workId: workIdA, tagId: tagHighId, provenance: 'manual' })
      .onConflictDoNothing();
    await db
      .insert(readingWorkTagTable)
      .values({ workId: workIdB, tagId: tagHighId, provenance: 'manual' })
      .onConflictDoNothing();
    await db
      .insert(readingWorkTagTable)
      .values({ workId: workIdA, tagId: tagLowId, provenance: 'manual' })
      .onConflictDoNothing();

    const suiteQuery = normalizeTag(suiteRunId);
    const top = await listExistingTagsTool().invoke({ query: suiteQuery, limit: 10 });
    const parsedTop = JSON.parse(top) as { tags: Array<{ name: string; usage: number }> };
    expect(parsedTop.tags.length).toBeGreaterThanOrEqual(2);
    expect(parsedTop.tags.every((tag, index) => index === 0 || parsedTop.tags[index - 1]!.usage >= tag.usage)).toBe(
      true,
    );
    const topNames = parsedTop.tags.map((tag) => tag.name);
    expect(topNames).toContain(tagHighName);
    expect(topNames).toContain(tagLowName);
    const highUsage = parsedTop.tags.find((tag) => tag.name === tagHighName)!.usage;
    const lowUsage = parsedTop.tags.find((tag) => tag.name === tagLowName)!.usage;
    expect(highUsage).toBeGreaterThanOrEqual(lowUsage);

    const searched = await listExistingTagsTool().invoke({ query: normalizeTag(tagLowName) });
    const parsedSearch = JSON.parse(searched) as { tags: Array<{ name: string; usage: number }> };
    expect(parsedSearch.tags.map((t) => t.name)).toContain(tagLowName);
  });

  it('list_categories returns the admin-managed enumeration with ids', async () => {
    const mysteryName = suiteLabel('Mystery');
    await ensureCategory(mysteryName);
    const raw = await listCategoriesTool().invoke({});
    const parsed = JSON.parse(raw) as { categories: Array<{ id: string; name: string }> };
    expect(parsed.categories.some((c) => c.name === mysteryName)).toBe(true);
    expect(parsed.categories.every((c) => Boolean(c.id))).toBe(true);
  });
});

function cookieHeader(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) {
    return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
  }
  const single = response.headers.get('set-cookie');
  return single ? single.split(';')[0]! : '';
}
