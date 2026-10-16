import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
  userLibraryItem as userLibraryItemTable,
  userWorkTag as userWorkTagTable,
} from '@gloaming/db';
import { discoverySource as discoverySourceTable, sourceRecord as sourceRecordTable } from '@gloaming/db/schema';

import { runContentParseWorkflow } from '@/application/commands/run-content-parse-workflow';
import { hashFileContent } from '@/domains/assets/uploads';
import { materializeSourceRecord } from '@/domains/discovery/materialization';
import { GutenbergEpubDownloadError } from '@/domains/discovery/materialization/download';
import { EpubCandidateSelectionError } from '@/domains/discovery/materialization/epub-candidate';
import * as epubWorkUpload from '@/domains/ingest/epub/work-upload';
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
const createdHashes: string[] = [];

const fetchMock = vi.fn();
let enqueueSpy: ReturnType<typeof vi.spyOn<typeof queueLib, 'enqueueDiscoveryImport'>>;

function epubResponse(bytes: Buffer): Response {
  return new Response(bytes, { status: 200, headers: { 'content-type': 'application/epub+zip' } });
}

async function createRecord(overrides: Partial<typeof sourceRecordTable.$inferInsert> = {}): Promise<{ id: string }> {
  const id = randomUUID();
  await db.insert(sourceRecordTable).values({
    id,
    sourceId,
    externalId: `${runId}-${id}`,
    title: 'Source Record Title',
    authors: [{ name: 'First Author' }, { name: 'Second Author' }],
    languages: ['en'],
    description: 'Source description',
    contentCandidates: [
      { format: 'epub', url: 'https://www.gutenberg.org/ebooks/1342.epub3.images' },
      { format: 'epub', url: PREFERRED_URL },
    ],
    availability: 'available',
    materializationStatus: 'not_materialized',
    ...overrides,
  });
  return { id };
}

async function sourceRow(id: string) {
  const [row] = await db.select().from(sourceRecordTable).where(eq(sourceRecordTable.id, id)).limit(1);
  return row;
}

describe('SourceRecord materialization on gloaming_test', () => {
  beforeAll(async () => {
    setObjectStoreForTests(memory);
    sourceId = randomUUID();
    await db.insert(discoverySourceTable).values({
      id: sourceId,
      sourceKey: `materialization_test_${runId}`,
      sourceType: 'gutenberg_rdf',
    });
    enqueueSpy = vi.spyOn(queueLib, 'enqueueDiscoveryImport').mockResolvedValue('materialization-test-job');
  });

  beforeEach(() => {
    memory.store.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    enqueueSpy.mockClear();
    enqueueSpy.mockResolvedValue('materialization-test-job');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    enqueueSpy?.mockRestore();
    const linked = await db
      .select({ workId: sourceRecordTable.workId })
      .from(sourceRecordTable)
      .where(eq(sourceRecordTable.sourceId, sourceId));
    const workIds = new Set<string>(createdWorkIds);
    for (const row of linked) {
      if (row.workId) {
        workIds.add(row.workId);
      }
    }
    if (workIds.size) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, [...workIds]));
    }
    if (createdHashes.length) {
      await db.delete(uploadedObjectTable).where(inArray(uploadedObjectTable.contentHash, createdHashes));
    }
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    resetObjectStoreCache();
  });

  it('materializes an available record with its preferred candidate into one ownerless unpublished Catalog Work', async () => {
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    createdHashes.push(hashFileContent(bytes));
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const result = await materializeSourceRecord(record.id);
    createdWorkIds.push(result.workId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(PREFERRED_URL);
    expect(result.reused).toBe(false);
    expect(result.materializationStatus).toBe('processing');
    expect(result.processingStatus).toBe('uploaded');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0]![0]).toBe('content-parse');
    expect(enqueueSpy.mock.calls[0]![1]).toMatchObject({ processingLane: 'discovery' });

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, result.workId));
    expect(work).toMatchObject({
      ownerUserId: null,
      originKind: null,
      visibility: 'catalog',
      publishedAt: null,
      processingStatus: 'uploaded',
      title: 'Source Record Title',
      author: 'First Author, Second Author',
      description: 'Source description',
      language: 'en',
    });

    const preserved = await sourceRow(record.id);
    expect(preserved).toMatchObject({ workId: result.workId, materializationStatus: 'processing' });

    const assets = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, result.workId));
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ kind: 'origin_file', status: 'ready' });
    expect(memory.store.has(assets[0]!.storageKey!)).toBe(true);

    // No Library / ReadingState / User Tag side effects.
    expect(
      await db.select().from(userLibraryItemTable).where(eq(userLibraryItemTable.workId, result.workId)),
    ).toHaveLength(0);
    expect(await db.select().from(readingStateTable).where(eq(readingStateTable.workId, result.workId))).toHaveLength(
      0,
    );
    expect(await db.select().from(userWorkTagTable).where(eq(userWorkTagTable.workId, result.workId))).toHaveLength(0);
  });

  it('reuses the linked Work on repeated calls without downloading or enqueuing again', async () => {
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    createdHashes.push(hashFileContent(bytes));
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const first = await materializeSourceRecord(record.id);
    createdWorkIds.push(first.workId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    const second = await materializeSourceRecord(record.id);
    expect(second.workId).toBe(first.workId);
    expect(second.reused).toBe(true);
    expect(second.materializationStatus).toBe('processing');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    expect(await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, first.workId))).toHaveLength(1);
  });

  it('serializes concurrent calls on the SourceRecord row lock so only one Work and one link exist', async () => {
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    const hash = hashFileContent(bytes);
    createdHashes.push(hash);
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const [a, b] = await Promise.all([materializeSourceRecord(record.id), materializeSourceRecord(record.id)]);
    const workIds = new Set([a.workId, b.workId]);
    createdWorkIds.push(...workIds);

    expect(workIds.size).toBe(1);
    expect(a.workId).toBe(b.workId);
    expect([a.reused, b.reused].filter((reused) => reused === false)).toHaveLength(1);

    expect(
      await db
        .select()
        .from(readingWorkTable)
        .where(inArray(readingWorkTable.id, [...workIds])),
    ).toHaveLength(1);
    const preserved = await sourceRow(record.id);
    expect(preserved?.workId).toBe(a.workId);
    expect(preserved?.materializationStatus).toBe('processing');

    const [uploaded] = await db.select().from(uploadedObjectTable).where(eq(uploadedObjectTable.contentHash, hash));
    expect(uploaded?.refCount).toBe(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
  });

  it('marks the record failed and preserves it when no preferred EPUB candidate exists', async () => {
    const record = await createRecord({
      contentCandidates: [{ format: 'html', url: 'https://www.gutenberg.org/ebooks/1342.html' }],
    });

    await expect(materializeSourceRecord(record.id)).rejects.toBeInstanceOf(EpubCandidateSelectionError);

    const preserved = await sourceRow(record.id);
    expect(preserved).toMatchObject({ workId: null, materializationStatus: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(memory.store.size).toBe(0);
  });

  it('marks the record failed without persisting an object when the download fails', async () => {
    const record = await createRecord();
    const storedBefore = memory.store.size;
    fetchMock.mockResolvedValue(new Response('upstream error', { status: 500 }));

    await expect(materializeSourceRecord(record.id)).rejects.toBeInstanceOf(GutenbergEpubDownloadError);

    const preserved = await sourceRow(record.id);
    expect(preserved).toMatchObject({ workId: null, materializationStatus: 'failed' });
    expect(memory.store.size).toBe(storedBefore);
  });

  it('keeps the linked Work, marks materialization failed, and re-enqueues the stored parse on repeat when enqueue fails', async () => {
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    const hash = hashFileContent(bytes);
    createdHashes.push(hash);
    fetchMock.mockImplementation(async () => epubResponse(bytes));
    enqueueSpy.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(materializeSourceRecord(record.id)).rejects.toThrow('queue unavailable');

    const linked = await sourceRow(record.id);
    expect(linked?.workId).toBeTruthy();
    expect(linked?.materializationStatus).toBe('failed');
    createdWorkIds.push(linked!.workId!);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, linked!.workId!));
    expect(work?.processingStatus).toBe('failed');

    const assets = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, linked!.workId!));
    expect(assets).toHaveLength(1);
    expect(memory.store.has(assets[0]!.storageKey!)).toBe(true);
    const [uploaded] = await db.select().from(uploadedObjectTable).where(eq(uploadedObjectTable.contentHash, hash));
    expect(uploaded?.refCount).toBe(1);

    // Repeated call re-enqueues the persisted parser retry on the same linked Work.
    enqueueSpy.mockClear();
    const repeated = await materializeSourceRecord(record.id);
    expect(repeated.workId).toBe(linked!.workId!);
    expect(repeated.reused).toBe(true);
    expect(repeated.materializationStatus).toBe('processing');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0]![0]).toBe('content-parse');
    expect(enqueueSpy.mock.calls[0]![1]).toMatchObject({ processingLane: 'discovery' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await sourceRow(record.id))?.materializationStatus).toBe('processing');
  });

  it('marks the linked SourceRecord ready after a successful catalog parse and reports ready on repeat', async () => {
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    createdHashes.push(hashFileContent(bytes));
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const created = await materializeSourceRecord(record.id);
    createdWorkIds.push(created.workId);
    expect((await sourceRow(record.id))?.materializationStatus).toBe('processing');

    await expect(runContentParseWorkflow(created.workId)).resolves.toBe(true);

    const [parsedWork] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.workId));
    expect(parsedWork?.processingStatus).toBe('parsed');
    expect(parsedWork?.publishedAt).toBeNull();
    expect((await sourceRow(record.id))?.materializationStatus).toBe('ready');

    enqueueSpy.mockClear();
    fetchMock.mockClear();
    const repeated = await materializeSourceRecord(record.id);
    expect(repeated.workId).toBe(created.workId);
    expect(repeated.reused).toBe(true);
    expect(repeated.materializationStatus).toBe('ready');
    expect(repeated.processingStatus).toBe('parsed');
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks the linked SourceRecord failed after a recorded parse failure', async () => {
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    createdHashes.push(hashFileContent(bytes));
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const created = await materializeSourceRecord(record.id);
    createdWorkIds.push(created.workId);

    // Corrupt the already-stored origin file so the linked Work fails at parse.
    const [asset] = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, created.workId));
    memory.store.set(asset!.storageKey!, { body: Buffer.from('not an epub'), contentType: 'application/epub+zip' });

    await expect(runContentParseWorkflow(created.workId)).rejects.toThrow();

    const [failedWork] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.workId));
    expect(failedWork?.processingStatus).toBe('failed');
    expect(failedWork?.publishedAt).toBeNull();
    expect((await sourceRow(record.id))?.materializationStatus).toBe('failed');
  });

  it('re-enqueues the existing failed Work on repeat without refetching or creating another Work', async () => {
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    const hash = hashFileContent(bytes);
    createdHashes.push(hash);
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const created = await materializeSourceRecord(record.id);
    createdWorkIds.push(created.workId);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    const [asset] = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, created.workId));
    memory.store.set(asset!.storageKey!, { body: Buffer.from('not an epub'), contentType: 'application/epub+zip' });
    await expect(runContentParseWorkflow(created.workId)).rejects.toThrow();
    expect((await sourceRow(record.id))?.materializationStatus).toBe('failed');

    enqueueSpy.mockClear();
    fetchMock.mockClear();

    const retried = await materializeSourceRecord(record.id);
    expect(retried.workId).toBe(created.workId);
    expect(retried.reused).toBe(true);
    expect(retried.materializationStatus).toBe('processing');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0]![0]).toBe('content-parse');
    expect(fetchMock).not.toHaveBeenCalled();

    // Same Work, same single origin asset and uploaded-object reference.
    expect(await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.workId))).toHaveLength(1);
    const originAssets = (
      await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, created.workId))
    ).filter((candidate) => candidate.kind === 'origin_file');
    expect(originAssets).toHaveLength(1);
    expect(originAssets[0]!.storageKey).toBe(asset!.storageKey);
    const [uploaded] = await db.select().from(uploadedObjectTable).where(eq(uploadedObjectTable.contentHash, hash));
    expect(uploaded?.refCount).toBe(1);
    expect((await sourceRow(record.id))?.materializationStatus).toBe('processing');

    // A second repeat must not enqueue again while the retry reservation is owned.
    const reserved = await materializeSourceRecord(record.id);
    expect(reserved.workId).toBe(created.workId);
    expect(reserved.materializationStatus).toBe('processing');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the reloaded Work status when a failed Work retry is claimed before the result is built', async () => {
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    createdHashes.push(hashFileContent(bytes));
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const created = await materializeSourceRecord(record.id);
    createdWorkIds.push(created.workId);

    const [asset] = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, created.workId));
    memory.store.set(asset!.storageKey!, { body: Buffer.from('not an epub'), contentType: 'application/epub+zip' });
    await expect(runContentParseWorkflow(created.workId)).rejects.toThrow();
    expect((await sourceRow(record.id))?.materializationStatus).toBe('failed');

    enqueueSpy.mockClear();
    fetchMock.mockClear();
    // Simulate the worker claiming the reserved parse retry before the caller reloads.
    enqueueSpy.mockImplementationOnce(async () => {
      await db
        .update(readingWorkTable)
        .set({ processingStatus: 'processing' })
        .where(eq(readingWorkTable.id, created.workId));
      return 'materialization-retry-claimed';
    });

    const retried = await materializeSourceRecord(record.id);
    expect(retried.workId).toBe(created.workId);
    expect(retried.reused).toBe(true);
    expect(retried.processingStatus).toBe('processing');
    expect(retried.materializationStatus).toBe('processing');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0]![0]).toBe('content-parse');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.workId))).toHaveLength(1);
  });

  it('preserves a ready SourceRecord when the parser completes before a delayed retry returns', async () => {
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    createdHashes.push(hashFileContent(bytes));
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const created = await materializeSourceRecord(record.id);
    createdWorkIds.push(created.workId);

    const [asset] = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, created.workId));
    memory.store.set(asset!.storageKey!, { body: Buffer.from('not an epub'), contentType: 'application/epub+zip' });
    await expect(runContentParseWorkflow(created.workId)).rejects.toThrow();
    expect((await sourceRow(record.id))?.materializationStatus).toBe('failed');

    enqueueSpy.mockClear();
    fetchMock.mockClear();
    // Simulate the parser completing the Work and marking the SourceRecord ready while
    // this retry request is still in flight (the retry reservation already succeeded).
    enqueueSpy.mockImplementationOnce(async () => {
      await db
        .update(readingWorkTable)
        .set({ processingStatus: 'parsed' })
        .where(eq(readingWorkTable.id, created.workId));
      await db
        .update(sourceRecordTable)
        .set({ materializationStatus: 'ready' })
        .where(eq(sourceRecordTable.id, record.id));
      return 'materialization-retry-completed';
    });

    const retried = await materializeSourceRecord(record.id);
    expect(retried.workId).toBe(created.workId);
    expect(retried.reused).toBe(true);
    expect(retried.processingStatus).toBe('parsed');
    expect(retried.materializationStatus).toBe('ready');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    // The delayed retry must not regress the completed materialization back to processing.
    expect((await sourceRow(record.id))?.materializationStatus).toBe('ready');
  });

  it('returns an in-progress linked Work without re-enqueuing or fetching', async () => {
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    createdHashes.push(hashFileContent(bytes));
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const created = await materializeSourceRecord(record.id);
    createdWorkIds.push(created.workId);

    await db
      .update(readingWorkTable)
      .set({ processingStatus: 'processing' })
      .where(eq(readingWorkTable.id, created.workId));

    enqueueSpy.mockClear();
    fetchMock.mockClear();
    const repeated = await materializeSourceRecord(record.id);
    expect(repeated.workId).toBe(created.workId);
    expect(repeated.reused).toBe(true);
    expect(repeated.processingStatus).toBe('processing');
    expect(repeated.materializationStatus).toBe('processing');
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves and returns the linked Work after the SourceRecord becomes unavailable', async () => {
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    createdHashes.push(hashFileContent(bytes));
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const created = await materializeSourceRecord(record.id);
    createdWorkIds.push(created.workId);

    await db.update(sourceRecordTable).set({ availability: 'unavailable' }).where(eq(sourceRecordTable.id, record.id));

    enqueueSpy.mockClear();
    fetchMock.mockClear();
    const repeated = await materializeSourceRecord(record.id);
    expect(repeated.workId).toBe(created.workId);
    expect(repeated.reused).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, created.workId))).toHaveLength(1);
    expect((await sourceRow(record.id))?.workId).toBe(created.workId);
  });

  it('releases the extra uploaded-object reference when atomic Work creation fails', async () => {
    const record = await createRecord();
    const bytes = await buildSampleEpubBytes();
    const hash = hashFileContent(bytes);
    createdHashes.push(hash);
    fetchMock.mockImplementation(async () => epubResponse(bytes));
    const createSpy = vi.spyOn(epubWorkUpload, 'createEpubIngestWork').mockRejectedValueOnce(new Error('create boom'));

    await expect(materializeSourceRecord(record.id)).rejects.toThrow('create boom');
    createSpy.mockRestore();

    const preserved = await sourceRow(record.id);
    expect(preserved).toMatchObject({ workId: null, materializationStatus: 'failed' });
    expect(await db.select().from(uploadedObjectTable).where(eq(uploadedObjectTable.contentHash, hash))).toHaveLength(
      0,
    );
    expect(memory.store.has(`epub/${hash}.epub`)).toBe(false);
    expect(await db.select().from(contentAssetTable).where(eq(contentAssetTable.contentHash, hash))).toHaveLength(0);
  });
});
