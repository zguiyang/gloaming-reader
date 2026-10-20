import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  readingWork as readingWorkTable,
  sourceRecord as sourceRecordTable,
  type SourceRecordMaterializationStatus,
} from '@gloaming/db/schema';
import type { WorkProcessingStatus } from '@gloaming/shared/works';

import { releaseUploadedObject } from '@/domains/assets/uploads';
import { joinAuthors } from '@/domains/ingest/epub';
import {
  canonicalEpubMimeType,
  createEpubIngestWork,
  enqueueCoreEpubParse,
  storeEpubSource,
} from '@/domains/ingest/epub/work-upload';
import { db } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';
import { objectExists, putObject } from '@/infra/storage';
import { AppError, NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

import { downloadGutenbergEpub } from './download';
import { selectGutenbergEpubCandidate } from './epub-candidate';

const materializationLogger = rootLogger.child({ module: 'SourceRecordMaterialization' });

/**
 * `reading_work.origin_meta` marker written when materialization stores the origin
 * file: the candidate URL whose download produced the `origin_file` asset. Failed-parse
 * retries compare it with the current `content_candidates` selection to decide whether
 * the stored bytes are still the ones the SourceRecord points at.
 */
const SOURCE_CANDIDATE_URL_KEY = 'sourceCandidateUrl';

/** Caller-owned transaction; lets a retry join the same atomic unit it decides in. */
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbExecutor = DbTransaction | typeof db;

type StoredEpubSource = NonNullable<Awaited<ReturnType<typeof storeEpubSource>>>;

/**
 * On-demand SourceRecord → ReadingWork materialization.
 *
 * It downloads exactly the one preferred EPUB candidate already present in synced
 * metadata, stores it through the shared upload/dedup layer, then atomically creates
 * one ownerless, unpublished Catalog ReadingWork with its original-file asset and links
 * it to the SourceRecord. The existing `content-parse` job is enqueued afterwards.
 *
 * DS-03A policy: `owner_user_id = NULL`, `visibility = 'catalog'`, `published_at = NULL`,
 * `origin_kind = NULL`. The SourceRecord `work_id` link is the provenance SSOT; no
 * Library item, ReadingState, or User Tag is created here.
 */

/** Domain-local failure for cases with no underlying download/ingest error to surface. */
export type SourceRecordMaterializationErrorCode = 'source_unavailable' | 'store_failed' | 'work_missing';

export class SourceRecordMaterializationError extends Error {
  readonly code: SourceRecordMaterializationErrorCode;

  constructor(code: SourceRecordMaterializationErrorCode, message: string) {
    super(message);
    this.name = 'SourceRecordMaterializationError';
    this.code = code;
  }
}

export type SourceRecordMaterializationResult = {
  readonly sourceRecordId: string;
  readonly workId: string;
  readonly title: string;
  readonly processingStatus: WorkProcessingStatus;
  readonly materializationStatus: SourceRecordMaterializationStatus;
  /** True when an already-linked Work was reused instead of creating one. */
  readonly reused: boolean;
};

type SourceRecordRow = typeof sourceRecordTable.$inferSelect;

async function loadSourceRecord(sourceRecordId: string): Promise<SourceRecordRow | null> {
  const [row] = await db.select().from(sourceRecordTable).where(eq(sourceRecordTable.id, sourceRecordId)).limit(1);
  return row ?? null;
}

/** Marks a record failed only while it still owns no Work, so a concurrent winner is never clobbered. */
async function markMaterializationFailedIfUnlinked(sourceRecordId: string): Promise<void> {
  await db
    .update(sourceRecordTable)
    .set({ materializationStatus: 'failed' })
    .where(and(eq(sourceRecordTable.id, sourceRecordId), isNull(sourceRecordTable.workId)));
}

/** Marks the Work we created as failed after a post-commit enqueue error, preserving the link. */
async function markMaterializationFailedForWork(sourceRecordId: string, workId: string): Promise<void> {
  await db
    .update(sourceRecordTable)
    .set({ materializationStatus: 'failed' })
    .where(and(eq(sourceRecordTable.id, sourceRecordId), eq(sourceRecordTable.workId, workId)));
}

/** Never let cleanup failures mask the materialization error that caused them. */
async function releaseUploadedObjectQuietly(storageKey: string): Promise<void> {
  try {
    await releaseUploadedObject(storageKey);
  } catch {
    // The best-effort cleanup contract lives in the shared asset layer; keep the
    // caller's original error and leave the SourceRecord authoritative.
  }
}

/** Deterministic, path-safe `.epub` filename; the candidate URL's format suffix is not a file extension. */
function fileNameForCandidate(externalId: string, url: string): string {
  const trimmed = externalId.trim();
  if (trimmed) {
    return `${trimmed}.epub`;
  }
  try {
    const leaf = new URL(url).pathname.split('/').pop();
    if (leaf) {
      return leaf.replace(/\.(images|noimages)$/i, '');
    }
  } catch {
    // fall through to a stable default
  }
  return 'source.epub';
}

type LinkedWorkRow = typeof readingWorkTable.$inferSelect;

async function loadLinkedWork(workId: string, sourceRecordId: string): Promise<LinkedWorkRow> {
  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);

  if (!work) {
    throw new SourceRecordMaterializationError(
      'work_missing',
      `Source record ${sourceRecordId} links to missing ReadingWork ${workId}`,
    );
  }

  return work;
}

function persistedRetryJobToken(work: LinkedWorkRow): string | undefined {
  const token = work.originMeta?.retryJobToken;
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/** The candidate URL whose download produced this Work's stored origin file, if recorded. */
function persistedSourceCandidateUrl(work: LinkedWorkRow): string | undefined {
  const url = work.originMeta?.[SOURCE_CANDIDATE_URL_KEY];
  return typeof url === 'string' && url.length > 0 ? url : undefined;
}

/** Persist (or refresh) the candidate-URL marker; callers own the surrounding atomic unit. */
async function recordSourceCandidateUrl(executor: DbExecutor, workId: string, candidateUrl: string): Promise<void> {
  await executor
    .update(readingWorkTable)
    .set({
      originMeta: sql`${readingWorkTable.originMeta} || ${JSON.stringify({
        [SOURCE_CANDIDATE_URL_KEY]: candidateUrl,
      })}::jsonb`,
    })
    .where(eq(readingWorkTable.id, workId));
}

function isFailedAtParse(work: LinkedWorkRow): boolean {
  return work.processingStatus === 'failed' && work.originMeta?.failedStep === 'parse';
}

function parseCompleted(work: LinkedWorkRow): boolean {
  return (
    work.processingStatus === 'parsed' || work.processingStatus === 'metadata' || work.processingStatus === 'ready'
  );
}

function toLinkedWorkResult(
  sourceRecordId: string,
  work: LinkedWorkRow,
  materializationStatus: SourceRecordMaterializationStatus,
): SourceRecordMaterializationResult {
  return {
    sourceRecordId,
    workId: work.id,
    title: work.title,
    processingStatus: work.processingStatus as WorkProcessingStatus,
    materializationStatus,
    reused: true,
  };
}

/** Update the linked SourceRecord only while it still points at this Work. */
async function setMaterializationStatusForWork(
  sourceRecordId: string,
  workId: string,
  status: SourceRecordMaterializationStatus,
): Promise<void> {
  await db
    .update(sourceRecordTable)
    .set({ materializationStatus: status })
    .where(and(eq(sourceRecordTable.id, sourceRecordId), eq(sourceRecordTable.workId, workId)));
}

/**
 * Set the linked SourceRecord to `processing` in one atomic statement, guarded by
 * the current linked Work row. A Work that already reached a parse-completed state
 * (`parsed`/`metadata`/`ready`) is never overwritten, so a parser that finished
 * before a delayed retry returns keeps its `ready` result.
 */
async function setMaterializationProcessingUnlessParseCompleted(sourceRecordId: string, workId: string): Promise<void> {
  await db
    .update(sourceRecordTable)
    .set({ materializationStatus: 'processing' })
    .where(
      and(
        eq(sourceRecordTable.id, sourceRecordId),
        eq(sourceRecordTable.workId, workId),
        sql`exists (
          select 1 from ${readingWorkTable}
          where ${readingWorkTable.id} = ${workId}
            and ${readingWorkTable.processingStatus} not in ('parsed', 'metadata', 'ready')
        )`,
      ),
    );
}

/** Re-read after a reservation race; never writes, so an in-flight retry is not clobbered. */
async function reloadLinkedWorkResult(
  sourceRecordId: string,
  workId: string,
): Promise<SourceRecordMaterializationResult> {
  const work = await loadLinkedWork(workId, sourceRecordId);
  const record = await loadSourceRecord(sourceRecordId);
  return toLinkedWorkResult(sourceRecordId, work, record?.materializationStatus ?? 'processing');
}

function isParseReservationUnavailable(error: unknown): boolean {
  return error instanceof AppError && error.code === ERROR_CODES.WORK.RESERVE_PARSE_FAILED;
}

/**
 * Decide whether a failed-parse retry must re-download before re-enqueuing:
 * exactly one usable origin_file object whose recorded candidate still matches the
 * current selection keeps the stored bytes; anything else redownloads.
 */
async function assessRetryRedownload(
  work: LinkedWorkRow,
  candidateUrl: string,
  executor: DbExecutor,
): Promise<RetryRedownloadDecision> {
  if (!(await originFileIsUsable(work.id, executor))) {
    return { redownload: true, reason: 'origin_missing' };
  }
  if (persistedSourceCandidateUrl(work) !== candidateUrl) {
    return { redownload: true, reason: 'candidate_changed' };
  }
  return { redownload: false, reason: 'unchanged' };
}

type RetryRedownloadDecision =
  | { readonly redownload: true; readonly reason: 'candidate_changed' | 'origin_missing' }
  | { readonly redownload: false; readonly reason: 'unchanged' };

/**
 * The stored origin is usable only as exactly one `ready` asset whose object still
 * exists in storage; a missing/duplicated row or an unreadable object forces the
 * retry to re-download instead of parsing stale or absent bytes.
 */
async function originFileIsUsable(workId: string, executor: DbExecutor): Promise<boolean> {
  const rows = await executor
    .select({ storageKey: contentAssetTable.storageKey, status: contentAssetTable.status })
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.workId, workId), eq(contentAssetTable.kind, 'origin_file')));
  const [row] = rows;
  if (rows.length !== 1 || !row?.storageKey || row.status !== 'ready') {
    return false;
  }
  try {
    return await objectExists(row.storageKey);
  } catch {
    // A storage probe failure is treated like a missing origin so the retry can restore it.
    return false;
  }
}

/** Never let a reload failure mask the retry error that caused it (same contract as quiet release). */
async function markRetryFailedIfStillFailedAtParse(sourceRecordId: string, workId: string): Promise<void> {
  try {
    const reloaded = await loadLinkedWork(workId, sourceRecordId);
    if (isFailedAtParse(reloaded)) {
      await setMaterializationStatusForWork(sourceRecordId, workId, 'failed');
    }
  } catch {
    // The caller's original error and the linked Work stay authoritative.
  }
}

/** No selectable candidate: keep the existing failure semantics — mark failed, download nothing. */
async function failRetryWithoutCandidate(
  sourceRecordId: string,
  work: LinkedWorkRow,
  error: unknown,
): Promise<SourceRecordMaterializationResult> {
  const current = await loadLinkedWork(work.id, sourceRecordId);
  if (!isFailedAtParse(current)) {
    // A concurrent retry already advanced the Work; report its state instead.
    return reloadLinkedWorkResult(sourceRecordId, work.id);
  }
  materializationLogger.warn(
    { sourceRecordId, workId: work.id, reDownload: false, reason: 'no_candidate' },
    'Parse retry has no re-downloadable EPUB candidate',
  );
  await setMaterializationStatusForWork(sourceRecordId, work.id, 'failed');
  throw error;
}

type RetryOriginSwapOutcome =
  | { readonly kind: 'swapped'; readonly replacedStorageKeys: string[] }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'no_candidate'; readonly error: unknown };

/**
 * Replace the Work's origin_file asset and candidate marker in one transaction
 * serialized by the existing SourceRecord row lock. The swap re-runs the decision
 * after acquiring the lock and only proceeds while the Work still owns the
 * failed-at-parse state (the same guard the workflow claim uses), so repeated or
 * concurrent retries converge on exactly one origin_file asset and never clobber
 * an advanced or in-flight parse.
 */
async function replaceOriginFileForRetry(input: {
  sourceRecordId: string;
  workId: string;
  candidateUrl: string;
  fileName: string;
  stored: StoredEpubSource;
}): Promise<RetryOriginSwapOutcome> {
  const { sourceRecordId, workId, candidateUrl, fileName, stored } = input;

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(sourceRecordTable)
      .where(eq(sourceRecordTable.id, sourceRecordId))
      .for('update')
      .limit(1);
    if (!locked) {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
    }
    if (locked.workId !== workId) {
      return { kind: 'stale' as const };
    }

    const [fresh] = await tx.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
    if (!fresh || !isFailedAtParse(fresh)) {
      return { kind: 'stale' as const };
    }

    let freshCandidateUrl: string;
    try {
      freshCandidateUrl = selectGutenbergEpubCandidate(locked).url;
    } catch (error) {
      return { kind: 'no_candidate' as const, error };
    }

    const decision = await assessRetryRedownload(fresh, freshCandidateUrl, tx);
    if (!decision.redownload) {
      // A concurrent retry already restored the origin; keep its single asset.
      return { kind: 'unchanged' as const };
    }
    if (freshCandidateUrl !== candidateUrl) {
      // The synced candidates moved while this retry was downloading; these bytes
      // are already stale, so leave the current origin for the next retry.
      return { kind: 'stale' as const };
    }

    const [claimed] = await tx
      .update(readingWorkTable)
      .set({
        originMeta: sql`${readingWorkTable.originMeta} || ${JSON.stringify({
          [SOURCE_CANDIDATE_URL_KEY]: candidateUrl,
        })}::jsonb`,
      })
      .where(
        and(
          eq(readingWorkTable.id, workId),
          eq(readingWorkTable.processingStatus, 'failed'),
          sql`${readingWorkTable.originMeta} ->> 'failedStep' = 'parse'`,
        ),
      )
      .returning({ id: readingWorkTable.id });
    if (!claimed) {
      return { kind: 'stale' as const };
    }

    const previous = await tx
      .select({ storageKey: contentAssetTable.storageKey })
      .from(contentAssetTable)
      .where(and(eq(contentAssetTable.workId, workId), eq(contentAssetTable.kind, 'origin_file')));
    await tx
      .delete(contentAssetTable)
      .where(and(eq(contentAssetTable.workId, workId), eq(contentAssetTable.kind, 'origin_file')));
    await tx.insert(contentAssetTable).values({
      id: randomUUID(),
      workId,
      kind: 'origin_file',
      status: 'ready',
      storageKey: stored.meta.storageKey,
      mimeType: canonicalEpubMimeType(stored.meta.mimeType),
      contentHash: stored.meta.contentHash,
      meta: { size: stored.meta.size, originalFileName: fileName, reused: stored.duplicated },
    });

    return { kind: 'swapped' as const, replacedStorageKeys: previous.map((row) => row.storageKey) };
  });
}

/** Download → store → replace origin_file + marker under the row lock → re-enqueue the parser. */
async function redownloadOriginForRetry(input: {
  sourceRecordId: string;
  work: LinkedWorkRow;
  record: SourceRecordRow;
  candidateUrl: string;
  reason: 'candidate_changed' | 'origin_missing';
}): Promise<SourceRecordMaterializationResult> {
  const { sourceRecordId, work, record, candidateUrl, reason } = input;
  const retryContext = { sourceRecordId, workId: work.id, candidateUrl, reDownload: true, reason };

  let downloaded: Awaited<ReturnType<typeof downloadGutenbergEpub>>;
  try {
    downloaded = await downloadGutenbergEpub(candidateUrl);
  } catch (error) {
    materializationLogger.warn({ ...retryContext, stage: 'download', err: error }, 'Parse retry re-download failed');
    await markRetryFailedIfStillFailedAtParse(sourceRecordId, work.id);
    throw error;
  }

  const fileName = fileNameForCandidate(record.externalId, candidateUrl);
  let stored: StoredEpubSource;
  try {
    const acquired = await storeEpubSource({
      fileName,
      body: downloaded.bytes,
      contentType: downloaded.contentType ?? 'application/epub+zip',
    });
    if (!acquired) {
      throw new SourceRecordMaterializationError('store_failed', 'Uploaded EPUB object was not registered');
    }
    stored = acquired;
  } catch (error) {
    materializationLogger.warn({ ...retryContext, stage: 'store', err: error }, 'Parse retry re-upload failed');
    await markRetryFailedIfStillFailedAtParse(sourceRecordId, work.id);
    throw error;
  }

  try {
    // A dedupe hit can outlive its object (external loss): the key is content-
    // addressed to exactly these bytes, so re-putting them restores the origin
    // instead of swapping in a row that still points at a missing object.
    if (stored.duplicated && !(await objectExists(stored.meta.storageKey))) {
      await putObject({ key: stored.meta.storageKey, body: downloaded.bytes, contentType: stored.meta.mimeType });
    }
  } catch (error) {
    await releaseUploadedObjectQuietly(stored.meta.storageKey);
    materializationLogger.warn({ ...retryContext, stage: 'restore', err: error }, 'Parse retry origin restore failed');
    await markRetryFailedIfStillFailedAtParse(sourceRecordId, work.id);
    throw error;
  }

  let outcome: RetryOriginSwapOutcome;
  try {
    outcome = await replaceOriginFileForRetry({ sourceRecordId, workId: work.id, candidateUrl, fileName, stored });
  } catch (error) {
    await releaseUploadedObjectQuietly(stored.meta.storageKey);
    materializationLogger.warn({ ...retryContext, stage: 'swap', err: error }, 'Parse retry origin swap failed');
    await markRetryFailedIfStillFailedAtParse(sourceRecordId, work.id);
    throw error;
  }

  if (outcome.kind !== 'swapped') {
    // The freshly uploaded object lost the race; drop its reference before falling back.
    await releaseUploadedObjectQuietly(stored.meta.storageKey);
  }

  if (outcome.kind === 'unchanged') {
    materializationLogger.info(
      { ...retryContext, stage: 'swap', outcome: 'unchanged' },
      'Parse retry origin swap skipped',
    );
    return enqueueParseRetry(sourceRecordId, work);
  }
  if (outcome.kind === 'stale') {
    materializationLogger.info({ ...retryContext, stage: 'swap', outcome: 'stale' }, 'Parse retry origin swap skipped');
    return reloadLinkedWorkResult(sourceRecordId, work.id);
  }
  if (outcome.kind === 'no_candidate') {
    return failRetryWithoutCandidate(sourceRecordId, work, outcome.error);
  }

  // The replaced origin rows are gone; drop their refs so dedupe/asset cleanup can reclaim them.
  for (const storageKey of outcome.replacedStorageKeys) {
    await releaseUploadedObjectQuietly(storageKey);
  }
  materializationLogger.info(
    { ...retryContext, stage: 'swap', outcome: 'swapped' },
    'Parse retry re-downloaded origin file',
  );
  return enqueueParseRetry(sourceRecordId, work);
}

/**
 * Re-enqueue the existing parser job for a failed linked Work without redownloading.
 * A concurrent reservation or an advanced Work reloads state instead of marking a
 * successful/in-flight retry as failed.
 */
async function enqueueParseRetry(
  sourceRecordId: string,
  work: LinkedWorkRow,
): Promise<SourceRecordMaterializationResult> {
  const retryJobToken = persistedRetryJobToken(work);
  if (!retryJobToken) {
    const record = await loadSourceRecord(sourceRecordId);
    return toLinkedWorkResult(sourceRecordId, work, record?.materializationStatus ?? 'failed');
  }

  try {
    await enqueueCoreEpubParse({
      workId: work.id,
      retryJobToken,
      currentStatus: 'failed',
      processingLane: 'discovery',
    });
  } catch (error) {
    if (isParseReservationUnavailable(error)) {
      return reloadLinkedWorkResult(sourceRecordId, work.id);
    }
    const reloaded = await loadLinkedWork(work.id, sourceRecordId);
    if (isFailedAtParse(reloaded)) {
      await setMaterializationStatusForWork(sourceRecordId, work.id, 'failed');
    }
    throw error;
  }

  await setMaterializationProcessingUnlessParseCompleted(sourceRecordId, work.id);
  // The parser may finish before this delayed retry returns; report the reloaded
  // Work row and the SourceRecord status the completion path may already have set.
  const current = await loadLinkedWork(work.id, sourceRecordId);
  const record = await loadSourceRecord(sourceRecordId);
  const materializationStatus: SourceRecordMaterializationStatus = parseCompleted(current)
    ? 'ready'
    : (record?.materializationStatus ?? 'processing');
  return toLinkedWorkResult(sourceRecordId, current, materializationStatus);
}

/**
 * Reuse an already-linked Work: report `ready` once parse completed, leave an
 * in-flight parse alone, and only re-enqueue the persisted parser job when the
 * Work is failed at the parse step. A failed parse first re-selects the current
 * `content_candidates` URL and re-downloads the origin file when it no longer
 * matches the recorded `originMeta.sourceCandidateUrl` (or the stored origin is
 * unusable); matching, usable bytes keep the existing re-enqueue-only behavior.
 */
async function resolveLinkedWork(sourceRecordId: string, workId: string): Promise<SourceRecordMaterializationResult> {
  const work = await loadLinkedWork(workId, sourceRecordId);

  if (isFailedAtParse(work)) {
    return retryFailedParse(sourceRecordId, work);
  }

  if (parseCompleted(work)) {
    await setMaterializationStatusForWork(sourceRecordId, work.id, 'ready');
    return toLinkedWorkResult(sourceRecordId, work, 'ready');
  }

  const record = await loadSourceRecord(sourceRecordId);
  return toLinkedWorkResult(sourceRecordId, work, record?.materializationStatus ?? 'processing');
}

/**
 * Retry a failed-at-parse Work: re-select the current candidate and, only when the
 * selection changed or the stored origin is unusable, re-download → store → replace
 * the origin_file asset and candidate marker under the SourceRecord row lock before
 * re-enqueuing the parser. Every decision logs `reDownload` plus its reason
 * (`candidate_changed` / `origin_missing` / `unchanged`) for observability.
 */
async function retryFailedParse(
  sourceRecordId: string,
  work: LinkedWorkRow,
): Promise<SourceRecordMaterializationResult> {
  const record = await loadSourceRecord(sourceRecordId);
  if (!record) {
    // The SourceRecord vanished mid-flight: there is no candidate to re-select,
    // so keep the original re-enqueue-only behavior.
    materializationLogger.info(
      { sourceRecordId, workId: work.id, reDownload: false, reason: 'record_missing' },
      'Parse retry redownload decision',
    );
    return enqueueParseRetry(sourceRecordId, work);
  }

  let candidateUrl: string;
  try {
    candidateUrl = selectGutenbergEpubCandidate(record).url;
  } catch (error) {
    return failRetryWithoutCandidate(sourceRecordId, work, error);
  }

  const decision = await assessRetryRedownload(work, candidateUrl, db);
  materializationLogger.info(
    {
      sourceRecordId,
      workId: work.id,
      candidateUrl,
      previousCandidateUrl: persistedSourceCandidateUrl(work) ?? null,
      reDownload: decision.redownload,
      reason: decision.reason,
    },
    'Parse retry redownload decision',
  );

  if (!decision.redownload) {
    return enqueueParseRetry(sourceRecordId, work);
  }

  return redownloadOriginForRetry({ sourceRecordId, work, record, candidateUrl, reason: decision.reason });
}

/**
 * Materializes one available SourceRecord into a linked ReadingWork.
 *
 * Repeated and concurrent calls reuse the same Work: the Work + asset insert and the
 * SourceRecord link share one transaction serialized by a `SELECT ... FOR UPDATE` row
 * lock, so a losing concurrent caller observes the committed link and releases its extra
 * uploaded-object reference instead of inserting a duplicate Work.
 */
export async function materializeSourceRecord(sourceRecordId: string): Promise<SourceRecordMaterializationResult> {
  const record = await loadSourceRecord(sourceRecordId);
  if (!record) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }

  if (record.workId) {
    return resolveLinkedWork(sourceRecordId, record.workId);
  }

  if (record.availability !== 'available') {
    await markMaterializationFailedIfUnlinked(sourceRecordId);
    throw new SourceRecordMaterializationError(
      'source_unavailable',
      `Source record ${sourceRecordId} is not available for materialization`,
    );
  }

  let candidateUrl: string;
  try {
    candidateUrl = selectGutenbergEpubCandidate(record).url;
  } catch (error) {
    await markMaterializationFailedIfUnlinked(sourceRecordId);
    throw error;
  }

  let downloaded: Awaited<ReturnType<typeof downloadGutenbergEpub>>;
  try {
    downloaded = await downloadGutenbergEpub(candidateUrl);
  } catch (error) {
    await markMaterializationFailedIfUnlinked(sourceRecordId);
    throw error;
  }

  const fileName = fileNameForCandidate(record.externalId, candidateUrl);
  let stored: NonNullable<Awaited<ReturnType<typeof storeEpubSource>>>;
  try {
    const acquired = await storeEpubSource({
      fileName,
      body: downloaded.bytes,
      contentType: downloaded.contentType ?? 'application/epub+zip',
    });
    if (!acquired) {
      throw new SourceRecordMaterializationError('store_failed', 'Uploaded EPUB object was not registered');
    }
    stored = acquired;
  } catch (error) {
    await markMaterializationFailedIfUnlinked(sourceRecordId);
    throw error;
  }

  const retryJobToken = randomUUID();
  let outcome:
    { kind: 'existing'; workId: string } | { kind: 'unavailable' } | { kind: 'created'; workId: string; title: string };
  try {
    outcome = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(sourceRecordTable)
        .where(eq(sourceRecordTable.id, sourceRecordId))
        .for('update')
        .limit(1);

      if (!locked) {
        throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
      }
      if (locked.workId) {
        return { kind: 'existing' as const, workId: locked.workId };
      }
      if (locked.availability !== 'available') {
        return { kind: 'unavailable' as const };
      }

      const work = await createEpubIngestWork(
        {
          fileName,
          meta: stored.meta,
          reused: stored.duplicated,
          originKind: null,
          ownerUserId: null,
          visibility: 'catalog',
          processingStatus: 'uploaded',
          retryJobToken,
          title: record.title || undefined,
          author: joinAuthors(record.authors.map((author) => author.name)),
          description: record.description ?? '',
          language: record.languages[0],
        },
        tx,
      );

      await tx
        .update(sourceRecordTable)
        .set({ workId: work.id, materializationStatus: 'processing' })
        .where(and(eq(sourceRecordTable.id, sourceRecordId), isNull(sourceRecordTable.workId)));

      // Record the candidate whose download produced this Work's origin file, so a
      // later failed-parse retry can detect a changed `content_candidates` selection.
      await recordSourceCandidateUrl(tx, work.id, candidateUrl);

      return { kind: 'created' as const, workId: work.id, title: work.title };
    });
  } catch (error) {
    await releaseUploadedObjectQuietly(stored.meta.storageKey);
    await markMaterializationFailedIfUnlinked(sourceRecordId);
    throw error;
  }

  if (outcome.kind === 'existing') {
    await releaseUploadedObjectQuietly(stored.meta.storageKey);
    return resolveLinkedWork(sourceRecordId, outcome.workId);
  }

  if (outcome.kind === 'unavailable') {
    await releaseUploadedObjectQuietly(stored.meta.storageKey);
    await markMaterializationFailedIfUnlinked(sourceRecordId);
    throw new SourceRecordMaterializationError(
      'source_unavailable',
      `Source record ${sourceRecordId} became unavailable before materialization`,
    );
  }

  try {
    await enqueueCoreEpubParse({
      workId: outcome.workId,
      retryJobToken,
      currentStatus: 'uploaded',
      processingLane: 'discovery',
    });
  } catch (error) {
    // The Work and its asset are linked now; keep them and let a later task retry parse.
    await markMaterializationFailedForWork(sourceRecordId, outcome.workId);
    throw error;
  }

  return {
    sourceRecordId,
    workId: outcome.workId,
    title: outcome.title,
    processingStatus: 'uploaded',
    materializationStatus: 'processing',
    reused: false,
  };
}
