import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readingWork as readingWorkTable, uploadedObject as uploadedObjectTable } from '@gloaming/db';

import { runContentParseWorkflow } from '@/application/commands/run-content-parse-workflow';
import { hashFileContent } from '@/domains/assets/uploads';
import { fillWorkMetadata } from '@/domains/metadata';
import { claimWorkflowStep, completeWorkflowStep, failWorkflowStep } from '@/domains/works/lifecycle';
import { db } from '@/infra/db';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/infra/storage';

import { buildEpubBytes } from '../../../helpers/epub-builder';
import { createCatalogEpubIngestFixture } from '../../../helpers/historical-catalog-epub-fixture';
import { createMemoryObjectStore } from '../../../helpers/memory-oss';

describe('metadata-fill for historical Catalog Works', () => {
  const memory = createMemoryObjectStore();
  const createdWorkIds: string[] = [];
  const createdContentHashes: string[] = [];

  beforeAll(() => {
    memory.store.clear();
    setObjectStoreForTests(memory);
  });

  afterAll(async () => {
    for (const workId of createdWorkIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
    for (const contentHash of createdContentHashes) {
      await db.delete(uploadedObjectTable).where(eq(uploadedObjectTable.contentHash, contentHash));
    }
    resetObjectStoreCache();
  });

  async function uploadAndFill(bytes: Buffer): Promise<string> {
    createdContentHashes.push(hashFileContent(bytes));
    const created = await createCatalogEpubIngestFixture({ fileName: 'book.epub', bytes });
    createdWorkIds.push(created.id);
    await runContentParseWorkflow(created.id);
    await fillWorkMetadata(created.id);
    return created.id;
  }

  it('fills supported EPUB metadata and ignores subject/source fields', async () => {
    const workId = await uploadAndFill(
      await buildEpubBytes({
        title: 'Subject Book',
        description: 'A sufficiently descriptive summary of a story about choices and consequences.',
        subjects: ['Science Fiction', 'Adventure'],
        sourceRaw: 'https://example.com/books/source',
        chapters: [
          { href: 'chapter-1.xhtml', tocLabel: 'Chapter 1', content: '<html><body><p>Body.</p></body></html>' },
        ],
      }),
    );

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.title).toBe('Subject Book');
    expect(work!.description).toContain('story about choices');
    expect(work!.descriptionProvenance).toBe('extracted');
    expect(work!.originMeta.parsed).not.toHaveProperty('subjects');
    expect(work!.originMeta.parsed).not.toHaveProperty('sourceRaw');
  });

  it('preserves AI description provenance when extracted metadata is filled again', async () => {
    const workId = await uploadAndFill(
      await buildEpubBytes({
        title: 'AI Book',
        description: 'An extracted but intentionally short description.',
        chapters: [{ href: 'chapter-1.xhtml', content: '<html><body><p>Body.</p></body></html>' }],
      }),
    );
    const description = 'An AI written description that is long enough and clearly differs from extraction.';
    await db
      .update(readingWorkTable)
      .set({ description, descriptionProvenance: 'ai' })
      .where(eq(readingWorkTable.id, workId));

    await fillWorkMetadata(workId);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.description).toBe(description);
    expect(work!.descriptionProvenance).toBe('ai');
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
        processingStatus: 'processing',
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
});
