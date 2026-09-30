import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  readingWork as readingWorkTable,
  readingWorkSource as readingWorkSourceTable,
  readingWorkTag as readingWorkTagTable,
  source as sourceTable,
  tag as tagTable,
  uploadedObject as uploadedObjectTable,
} from '@gloaming/db';

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
  const createdTagIds: string[] = [];
  const testSourceId = `src-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceHost = `standardebooks-${Date.now()}.example`;

  beforeAll(async () => {
    memory.store.clear();
    setObjectStoreForTests(memory);
    await db
      .insert(sourceTable)
      .values({
        id: testSourceId,
        name: `Test Source ${testSourceId}`,
        matchRule: sourceHost,
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
    const created = await createCatalogEpubIngestFixture({ fileName: 'book.epub', bytes });
    createdWorkIds.push(created.id);
    await runContentParseWorkflow(created.id);
    await fillWorkMetadata(created.id);
    return created.id;
  }

  it('keeps rule subjects as AI-only candidates and writes source associations', async () => {
    const workId = await uploadAndFill(
      await buildEpubBytes({
        title: 'Subject Book',
        subjects: ['Zeta Alpha', 'Zeta Beta'],
        sourceRaw: `https://${sourceHost}/ebooks/some-book`,
        chapters: [
          { href: 'chapter-1.xhtml', tocLabel: 'Chapter 1', content: '<html><body><p>Body.</p></body></html>' },
        ],
      }),
    );

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work!.title).toBe('Subject Book');

    const tagRows = await db
      .select({ name: tagTable.name, provenance: readingWorkTagTable.provenance })
      .from(readingWorkTagTable)
      .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
      .where(eq(readingWorkTagTable.workId, workId))
      .orderBy(tagTable.name);
    expect(tagRows).toEqual([]);

    // Rule subjects never create global dimensions before AI adjudication.
    const extractedOrigins = await db
      .select({ origin: tagTable.origin })
      .from(tagTable)
      .where(inArray(tagTable.name, ['Zeta Alpha', 'Zeta Beta']));
    expect(extractedOrigins).toEqual([]);

    const sourceRows = await db.select().from(readingWorkSourceTable).where(eq(readingWorkSourceTable.workId, workId));
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]!.sourceId).toBe(testSourceId);
    expect(sourceRows[0]!.provenance).toBe('extracted');
  });

  it('keeps raw LCSH subjects for AI hints without storing them as tags', async () => {
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
    expect(tagNames.map((row) => row.name)).toEqual([]);
  });

  it('is idempotent: re-running fill keeps rule-derived associations empty', async () => {
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
    expect(tagRows).toHaveLength(0);
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
    const tagId = `tag-ai-provenance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tagName = `AI Tag ${tagId}`;
    const [aiRow] = await db
      .insert(tagTable)
      .values({ id: tagId, name: tagName, normalized: tagId.toLowerCase() })
      .returning({ id: tagTable.id });
    createdTagIds.push(aiRow!.id);
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
