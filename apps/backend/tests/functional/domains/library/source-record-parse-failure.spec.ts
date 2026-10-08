import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
  user as userTable,
  userLibraryItem as userLibraryItemTable,
} from '@gloaming/db';
import {
  discoverySource as discoverySourceTable,
  sourceRecord as sourceRecordTable,
  sourceRecordSaveIntent as saveIntentTable,
} from '@gloaming/db/schema';

import { processContentParse } from '@/application/jobs/content-parse';
import { hashFileContent } from '@/domains/assets/uploads';
import { materializeSourceRecord } from '@/domains/discovery/materialization';
import {
  failSaveIntentsForWorkParseFailure,
  reviveFailedSaveIntentsForWorkParseRetry,
} from '@/domains/library/save-intent';
import { db } from '@/infra/db';
import * as queueLib from '@/infra/queue';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/infra/storage';

import { buildSampleEpubBytes } from '../../../helpers/epub-builder';
import { createMemoryObjectStore } from '../../../helpers/memory-oss';

const memory = createMemoryObjectStore();
const runId = randomUUID();
const PREFERRED_URL = 'https://www.gutenberg.org/cache/epub/1342/pg1342.epub.images';

let sourceId = '';
const createdWorkIds: string[] = [];
const createdUserIds: string[] = [];
const createdHashes: string[] = [];

const fetchMock = vi.fn();
let enqueueSpy: ReturnType<typeof vi.spyOn<typeof queueLib, 'enqueue'>>;

function epubResponse(bytes: Buffer): Response {
  return new Response(bytes, { status: 200, headers: { 'content-type': 'application/epub+zip' } });
}

async function createUser(): Promise<string> {
  const id = randomUUID();
  await db.insert(userTable).values({ id, name: 'Parse Failure User', email: `${id}@example.com` });
  createdUserIds.push(id);
  return id;
}

async function createRecord(): Promise<{ id: string }> {
  const id = randomUUID();
  await db.insert(sourceRecordTable).values({
    id,
    sourceId,
    externalId: `${runId}-${id}`,
    title: 'Parse Failure Record',
    authors: [{ name: 'Author' }],
    languages: ['en'],
    contentCandidates: [{ format: 'epub', url: PREFERRED_URL }],
    availability: 'available',
    materializationStatus: 'not_materialized',
  });
  return { id };
}

async function insertPendingIntent(userId: string, sourceRecordId: string): Promise<void> {
  await db
    .insert(saveIntentTable)
    .values({ id: randomUUID(), userId, sourceRecordId, status: 'pending' })
    .onConflictDoNothing({ target: [saveIntentTable.userId, saveIntentTable.sourceRecordId] });
}

async function intentRow(sourceRecordId: string) {
  const [row] = await db
    .select()
    .from(saveIntentTable)
    .where(eq(saveIntentTable.sourceRecordId, sourceRecordId))
    .limit(1);
  return row;
}

async function membershipRows(workId: string) {
  return db.select().from(userLibraryItemTable).where(eq(userLibraryItemTable.workId, workId));
}

/** Materialize a SourceRecord into a linked Work with a stored origin file, then return its ids. */
async function materializeLinkedWork(): Promise<{ recordId: string; workId: string; retryJobToken: string }> {
  const record = await createRecord();
  const bytes = await buildSampleEpubBytes();
  createdHashes.push(hashFileContent(bytes));
  fetchMock.mockImplementation(async () => epubResponse(bytes));

  const result = await materializeSourceRecord(record.id);
  createdWorkIds.push(result.workId);

  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, result.workId)).limit(1);
  const retryJobToken = String(work!.originMeta.retryJobToken ?? '');
  expect(retryJobToken).not.toBe('');

  const [asset] = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, result.workId)).limit(1);
  // Corrupt the stored origin file so the real parser fails.
  memory.store.set(asset!.storageKey!, { body: Buffer.from('not an epub'), contentType: 'application/epub+zip' });

  return { recordId: record.id, workId: result.workId, retryJobToken };
}

describe('SourceRecord-linked content-parse failure propagation on gloaming_test', () => {
  beforeAll(async () => {
    setObjectStoreForTests(memory);
    sourceId = randomUUID();
    await db.insert(discoverySourceTable).values({
      id: sourceId,
      sourceKey: `parse_failure_test_${runId}`,
      sourceType: 'gutenberg_rdf',
    });
    enqueueSpy = vi.spyOn(queueLib, 'enqueue').mockResolvedValue('parse-failure-test-job');
  });

  beforeEach(() => {
    memory.store.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    enqueueSpy.mockClear();
    enqueueSpy.mockResolvedValue('parse-failure-test-job');
  });

  afterAll(async () => {
    enqueueSpy?.mockRestore();
    vi.unstubAllGlobals();
    if (createdWorkIds.length) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    }
    if (createdHashes.length) {
      await db.delete(uploadedObjectTable).where(inArray(uploadedObjectTable.contentHash, createdHashes));
    }
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    for (const id of createdUserIds) {
      await db.delete(userTable).where(eq(userTable.id, id));
    }
    resetObjectStoreCache();
  });

  it('fails pending intents and creates no membership when a linked parse ultimately fails', async () => {
    const userId = await createUser();
    const { recordId, workId, retryJobToken } = await materializeLinkedWork();
    await insertPendingIntent(userId, recordId);

    await expect(processContentParse({ workId, retryJobToken })).rejects.toThrow();

    const intent = await intentRow(recordId);
    expect(intent).toMatchObject({ userId, status: 'failed', failureCode: 'epub_invalid' });
    expect(typeof intent?.failureReason).toBe('string');
    expect((intent?.failureReason ?? '').length).toBeGreaterThan(0);
    expect(intent?.failureReason).not.toContain('\n');

    expect(await membershipRows(workId)).toHaveLength(0);
    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work?.processingStatus).toBe('failed');
    expect(work?.publishedAt).toBeNull();
    const [record] = await db.select().from(sourceRecordTable).where(eq(sourceRecordTable.id, recordId));
    expect(record?.materializationStatus).toBe('failed');
  });

  it('does not fail intents for an unlinked Personal Work parse failure', async () => {
    const userId = await createUser();
    const { recordId } = await materializeLinkedWork();
    await insertPendingIntent(userId, recordId);

    const personalWorkId = randomUUID();
    createdWorkIds.push(personalWorkId);
    await db.insert(readingWorkTable).values({
      id: personalWorkId,
      title: 'Personal Broken Work',
      ownerUserId: userId,
      visibility: 'private',
      originKind: 'user_epub',
      processingStatus: 'failed',
      originMeta: { failedStep: 'parse', retryJobToken: 'personal-retry' },
    });

    // The parse-failure hook must ignore Works that are not SourceRecord-linked.
    await failSaveIntentsForWorkParseFailure(personalWorkId, { code: 'parse_failed', reason: 'personal parse broke' });

    expect((await intentRow(recordId))?.status).toBe('pending');
    expect(await membershipRows(personalWorkId)).toHaveLength(0);
  });

  it('completes pending intents when a linked parse succeeds (success fan-out not regressed)', async () => {
    const userId = await createUser();
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    createdHashes.push(hashFileContent(bytes));
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const result = await materializeSourceRecord(record.id);
    createdWorkIds.push(result.workId);
    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, result.workId)).limit(1);
    const retryJobToken = String(work!.originMeta.retryJobToken ?? '');
    await insertPendingIntent(userId, record.id);

    await processContentParse({ workId: result.workId, retryJobToken });

    expect((await intentRow(record.id))?.status).toBe('completed');
    expect(await membershipRows(result.workId)).toHaveLength(1);
    const [parsed] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, result.workId));
    expect(parsed?.publishedAt).toBeNull();
  });

  it('revives failed intents before a retry so a later success can complete them', async () => {
    const userId = await createUser();
    const { recordId, workId, retryJobToken } = await materializeLinkedWork();
    await insertPendingIntent(userId, recordId);

    // Real failure via the job path marks the intent failed.
    await expect(processContentParse({ workId, retryJobToken })).rejects.toThrow();
    expect((await intentRow(recordId))?.status).toBe('failed');

    // Restore a valid origin file, then retry the same parse.
    const [asset] = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, workId)).limit(1);
    const validBytes = await buildSampleEpubBytes();
    memory.store.set(asset!.storageKey!, { body: validBytes, contentType: 'application/epub+zip' });

    // The retry hook alone must return the failed intent to pending.
    await reviveFailedSaveIntentsForWorkParseRetry(workId);
    expect((await intentRow(recordId))?.status).toBe('pending');
  });
});
