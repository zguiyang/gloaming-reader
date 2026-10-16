import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  readingWork as readingWorkTable,
  sourceRecord as sourceRecordTable,
  type SourceRecordMaterializationStatus,
} from '@gloaming/db/schema';
import type { WorkProcessingStatus } from '@gloaming/shared/works';

import { releaseUploadedObject } from '@/domains/assets/uploads';
import { joinAuthors } from '@/domains/ingest/epub';
import { createEpubIngestWork, enqueueCoreEpubParse, storeEpubSource } from '@/domains/ingest/epub/work-upload';
import { db } from '@/infra/db';
import { AppError, NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

import { downloadGutenbergEpub } from './download';
import { selectGutenbergEpubCandidate } from './epub-candidate';

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
 * Reuse an already-linked Work: report `ready` once parse completed, leave an
 * in-flight parse alone, and only re-enqueue the persisted parser job when the
 * Work is failed at the parse step.
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
 * Re-enqueue the existing parser job for a failed linked Work without redownloading.
 * A concurrent reservation or an advanced Work reloads state instead of marking a
 * successful/in-flight retry as failed.
 */
async function retryFailedParse(
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
