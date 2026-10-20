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

import { buildEpubBytes, buildSampleEpubBytes } from '../../../helpers/epub-builder';
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

async function originAssetsOf(workId: string) {
  const assets = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, workId));
  return assets.filter((candidate) => candidate.kind === 'origin_file');
}

/**
 * Materialize a fresh available record, then corrupt its stored origin file so the
 * linked Work really fails at the parse step (failedStep = 'parse').
 */
async function materializeThenFailParse(): Promise<{
  recordId: string;
  workId: string;
  asset: typeof contentAssetTable.$inferSelect;
  bytes: Buffer;
}> {
  const record = await createRecord();
  const bytes = await buildSampleEpubBytes();
  createdHashes.push(hashFileContent(bytes));
  fetchMock.mockImplementation(async () => epubResponse(bytes));

  const created = await materializeSourceRecord(record.id);
  createdWorkIds.push(created.workId);
  expect((await sourceRow(record.id))?.materializationStatus).toBe('processing');

  const [asset] = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, created.workId));
  memory.store.set(asset!.storageKey!, { body: Buffer.from('not an epub'), contentType: 'application/epub+zip' });
  await expect(runContentParseWorkflow(created.workId)).rejects.toThrow();
  expect((await sourceRow(record.id))?.materializationStatus).toBe('failed');

  return { recordId: record.id, workId: created.workId, asset: asset!, bytes };
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

    // The candidate whose download produced this Work is recorded for later retries.
    expect(work?.originMeta.sourceCandidateUrl).toBe(PREFERRED_URL);

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

  it('re-downloads the updated candidate URL and swaps the origin asset on a failed-parse retry', async () => {
    const { recordId, workId, asset: previousAsset } = await materializeThenFailParse();
    const staleHash = previousAsset.contentHash;

    // The metadata sync replaced the candidate list (e.g. .epub3 → canonical mirror).
    const updatedUrl = 'https://www.gutenberg.org/cache/epub/1342/pg1342-images.epub';
    await db
      .update(sourceRecordTable)
      .set({ contentCandidates: [{ format: 'epub', url: updatedUrl }] })
      .where(eq(sourceRecordTable.id, recordId));

    const freshBytes = await buildEpubBytes({
      title: 'Re-downloaded Book',
      authors: ['Retry Author'],
      chapters: [
        {
          href: 'chapter-1.xhtml',
          tocLabel: 'Chapter 1',
          content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head>
<body><h1>Chapter 1</h1><p>Freshly re-downloaded content.</p></body></html>`,
        },
      ],
    });
    const freshHash = hashFileContent(freshBytes);
    createdHashes.push(freshHash);
    fetchMock.mockClear();
    enqueueSpy.mockClear();
    fetchMock.mockImplementation(async () => epubResponse(freshBytes));

    const retried = await materializeSourceRecord(recordId);
    expect(retried.workId).toBe(workId);
    expect(retried.reused).toBe(true);
    expect(retried.materializationStatus).toBe('processing');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(updatedUrl);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0]![0]).toBe('content-parse');
    expect(enqueueSpy.mock.calls[0]![1]).toMatchObject({ processingLane: 'discovery' });

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work?.originMeta.sourceCandidateUrl).toBe(updatedUrl);

    const originAssets = await originAssetsOf(workId);
    expect(originAssets).toHaveLength(1);
    expect(originAssets[0]).toMatchObject({
      status: 'ready',
      contentHash: freshHash,
      mimeType: 'application/epub+zip',
    });
    expect(originAssets[0]!.storageKey).not.toBe(previousAsset.storageKey);
    expect(memory.store.has(originAssets[0]!.storageKey!)).toBe(true);

    // The replaced origin loses its upload reference, so asset cleanup can reclaim it.
    expect(memory.store.has(previousAsset.storageKey!)).toBe(false);
    expect(
      await db.select().from(uploadedObjectTable).where(eq(uploadedObjectTable.contentHash, staleHash)),
    ).toHaveLength(0);
    const [freshUpload] = await db
      .select()
      .from(uploadedObjectTable)
      .where(eq(uploadedObjectTable.contentHash, freshHash));
    expect(freshUpload?.refCount).toBe(1);

    // A repeat retry with the now-matching marker only re-enqueues: no second download.
    const repeat = await materializeSourceRecord(recordId);
    expect(repeat.workId).toBe(workId);
    expect(repeat.materializationStatus).toBe('processing');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(await originAssetsOf(workId)).toHaveLength(1);

    // The re-downloaded origin is what the next parse actually reads.
    await expect(runContentParseWorkflow(workId)).resolves.toBe(true);
    const [parsed] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(parsed?.processingStatus).toBe('parsed');
    expect((await sourceRow(recordId))?.materializationStatus).toBe('ready');
  });

  it('re-downloads when the stored origin object is missing, keeping a single upload reference', async () => {
    const { recordId, workId, asset, bytes } = await materializeThenFailParse();

    // The registry row survives but the object itself was lost externally.
    await memory.store.delete(asset.storageKey!);
    fetchMock.mockClear();
    enqueueSpy.mockClear();
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const retried = await materializeSourceRecord(recordId);
    expect(retried.workId).toBe(workId);
    expect(retried.materializationStatus).toBe('processing');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(PREFERRED_URL);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    const originAssets = await originAssetsOf(workId);
    expect(originAssets).toHaveLength(1);
    // Same bytes dedupe onto the same content-addressed key, restored in storage.
    expect(originAssets[0]!.storageKey).toBe(asset.storageKey);
    expect(memory.store.has(asset.storageKey!)).toBe(true);
    const [uploaded] = await db
      .select()
      .from(uploadedObjectTable)
      .where(eq(uploadedObjectTable.contentHash, asset.contentHash));
    expect(uploaded?.refCount).toBe(1);
    expect((await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId))).length).toBe(1);
  });

  it('marks the linked retry failed without downloading when no candidate remains', async () => {
    const { recordId, workId, asset } = await materializeThenFailParse();

    await db
      .update(sourceRecordTable)
      .set({ contentCandidates: [{ format: 'html', url: 'https://www.gutenberg.org/ebooks/1342.html' }] })
      .where(eq(sourceRecordTable.id, recordId));
    fetchMock.mockClear();
    enqueueSpy.mockClear();

    await expect(materializeSourceRecord(recordId)).rejects.toBeInstanceOf(EpubCandidateSelectionError);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect((await sourceRow(recordId))?.materializationStatus).toBe('failed');
    // Nothing about the linked Work or its origin changed.
    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work?.processingStatus).toBe('failed');
    expect(work?.originMeta.sourceCandidateUrl).toBe(PREFERRED_URL);
    const originAssets = await originAssetsOf(workId);
    expect(originAssets).toHaveLength(1);
    expect(originAssets[0]!.storageKey).toBe(asset.storageKey);
  });

  it('re-downloads for a legacy Work without a recorded candidate marker', async () => {
    const { recordId, workId, asset, bytes } = await materializeThenFailParse();

    // Simulate a Work materialized before the marker existed.
    const [before] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    const legacyMeta = { ...before!.originMeta };
    delete legacyMeta.sourceCandidateUrl;
    await db.update(readingWorkTable).set({ originMeta: legacyMeta }).where(eq(readingWorkTable.id, workId));

    fetchMock.mockClear();
    enqueueSpy.mockClear();
    fetchMock.mockImplementation(async () => epubResponse(bytes));

    const retried = await materializeSourceRecord(recordId);
    expect(retried.workId).toBe(workId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(PREFERRED_URL);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    const originAssets = await originAssetsOf(workId);
    expect(originAssets).toHaveLength(1);
    expect(originAssets[0]!.storageKey).toBe(asset.storageKey);
    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work?.originMeta.sourceCandidateUrl).toBe(PREFERRED_URL);
    const [uploaded] = await db
      .select()
      .from(uploadedObjectTable)
      .where(eq(uploadedObjectTable.contentHash, asset.contentHash));
    expect(uploaded?.refCount).toBe(1);
  });

  it('serializes concurrent redownload retries onto one origin_file asset', async () => {
    const { recordId, workId, asset: previousAsset } = await materializeThenFailParse();
    const staleHash = previousAsset.contentHash;

    const updatedUrl = 'https://www.gutenberg.org/cache/epub/1342/pg1342-images.epub';
    await db
      .update(sourceRecordTable)
      .set({ contentCandidates: [{ format: 'epub', url: updatedUrl }] })
      .where(eq(sourceRecordTable.id, recordId));

    const freshBytes = await buildEpubBytes({
      title: 'Concurrent Retry Book',
      authors: ['Retry Author'],
      chapters: [
        {
          href: 'chapter-1.xhtml',
          tocLabel: 'Chapter 1',
          content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head>
<body><h1>Chapter 1</h1><p>Concurrency content.</p></body></html>`,
        },
      ],
    });
    const freshHash = hashFileContent(freshBytes);
    createdHashes.push(freshHash);
    fetchMock.mockClear();
    enqueueSpy.mockClear();
    fetchMock.mockImplementation(async () => epubResponse(freshBytes));

    const [first, second] = await Promise.all([materializeSourceRecord(recordId), materializeSourceRecord(recordId)]);

    expect(first.workId).toBe(workId);
    expect(second.workId).toBe(workId);
    // Every download this race performed used the updated candidate.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe(updatedUrl);
    }
    // The parse reservation still admits exactly one queue job.
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    const originAssets = await originAssetsOf(workId);
    expect(originAssets).toHaveLength(1);
    expect(originAssets[0]!.contentHash).toBe(freshHash);

    // The replaced origin is reclaimed and the losing upload reference released.
    expect(
      await db.select().from(uploadedObjectTable).where(eq(uploadedObjectTable.contentHash, staleHash)),
    ).toHaveLength(0);
    const [freshUpload] = await db
      .select()
      .from(uploadedObjectTable)
      .where(eq(uploadedObjectTable.contentHash, freshHash));
    expect(freshUpload?.refCount).toBe(1);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work?.originMeta.sourceCandidateUrl).toBe(updatedUrl);
  });
});
