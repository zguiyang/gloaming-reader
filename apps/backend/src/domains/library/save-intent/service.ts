import { randomUUID } from 'node:crypto';

import { and, asc, eq, lt, lte } from 'drizzle-orm';

import {
  discoverySource as discoverySourceTable,
  readingWork as readingWorkTable,
  sourceRecord as sourceRecordTable,
  sourceRecordSaveIntent as saveIntentTable,
  userLibraryItem as userLibraryItemTable,
} from '@gloaming/db/schema';
import type { SourceRecordSaveStatus } from '@gloaming/shared/library';
import { isWorkParseCompleted } from '@gloaming/shared/works';

import { hasSelectableEpubCandidate } from '@/domains/discovery/materialization';
import { db } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';
import { enqueueDiscoveryImport } from '@/infra/queue';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError, NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

const saveIntentLogger = rootLogger.child({ module: 'SaveIntent' });

/**
 * SourceRecord "Save intent" lifecycle.
 *
 * A save intent is the durable, `(user_id, source_record_id)`-unique record of a
 * user's wish to have a SourceRecord in their Library. It never is a membership:
 * membership (`user_library_item`) is created only after the SourceRecord has a
 * readable ReadingWork. Pending/failed intents are invisible to `GET /api/library`.
 *
 * The SourceRecord → ReadingWork link stays shared across users; every pending
 * intent is fanned out to its own membership once the shared import is ready.
 */

/** Job name for the asynchronous SourceRecord-level materialization worker. */
export const SOURCE_RECORD_MATERIALIZE_JOB = 'source-record-materialize';

/**
 * Recovery thresholds for a stale `pending` Save Intent (exported for tests).
 *
 * A pending intent is re-enqueued once it has been untouched for 10 minutes and
 * hard-fails once the attempt itself is 30 minutes old. The deadline is measured
 * from `created_at`, not `updated_at`, because recovery refreshes `updated_at`
 * on every re-enqueue — measuring the deadline from the refreshed column would
 * let a lost job re-queue forever and keep the client polling forever.
 */
export const SAVE_INTENT_REENQUEUE_AFTER_MS = 10 * 60_000;
export const SAVE_INTENT_TIMEOUT_AFTER_MS = 30 * 60_000;

/** Upper bound of stale intents handled by one global recovery pass. */
export const SAVE_INTENT_RECOVERY_SCAN_LIMIT = 100;

/** failureCode written when the materialization job could not be queued. */
const ENQUEUE_FAILURE_CODE = 'enqueue_failed';
/** failureCode written when a pending intent outlives its timeout deadline. */
const TIMEOUT_FAILURE_CODE = 'processing_timeout';

/** Displayable reason for a timed-out intent; never a raw error or stack. */
const TIMEOUT_FAILURE_REASON = 'Content import did not finish in time. Please retry.';
/** Fallback reason when a queue error carries no cleanable message. */
const ENQUEUE_FAILURE_FALLBACK_REASON = 'Could not queue the content import';

export type SourceRecordMaterializeJobData = { sourceRecordId: string };

export type SaveSourceRecordStatus = 'pending' | 'ready';

export type SaveSourceRecordResult = {
  readonly status: SaveSourceRecordStatus;
  readonly workId: string | null;
};

/** Cleaned failure payload for a pending intent; never a raw stack or response body. */
export type SaveIntentFailure = {
  readonly code: string;
  readonly reason: string | null;
};

type SavableSourceRecord = {
  readonly id: string;
  readonly workId: string | null;
};

/**
 * Save accepts only an enabled source's currently available record, and only
 * when its synced metadata still offers a selectable EPUB candidate — the same
 * rule the Discover read model's `isSaveable` flag applies. Disabled sources,
 * unavailable records, and records without an EPUB candidate are rejected
 * before any Save Intent is created or revived and before anything is queued.
 * A later candidate sync needs no cached failure: the next POST re-reads the
 * record and passes this gate.
 */
async function loadSavableSourceRecord(sourceRecordId: string): Promise<SavableSourceRecord> {
  const [row] = await db
    .select({
      id: sourceRecordTable.id,
      workId: sourceRecordTable.workId,
      availability: sourceRecordTable.availability,
      contentCandidates: sourceRecordTable.contentCandidates,
      enabled: discoverySourceTable.enabled,
    })
    .from(sourceRecordTable)
    .innerJoin(discoverySourceTable, eq(sourceRecordTable.sourceId, discoverySourceTable.id))
    .where(eq(sourceRecordTable.id, sourceRecordId))
    .limit(1);

  if (!row || !row.enabled || row.availability !== 'available') {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }
  if (!hasSelectableEpubCandidate({ contentCandidates: row.contentCandidates })) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.LIBRARY.SOURCE_RECORD_NO_EPUB_CANDIDATE);
  }
  return { id: row.id, workId: row.workId };
}

/** Create or revive the intent. Repeated pending saves are a no-op; failed saves retry. */
async function ensurePendingIntent(userId: string, sourceRecordId: string): Promise<void> {
  await db
    .insert(saveIntentTable)
    .values({ id: randomUUID(), userId, sourceRecordId, status: 'pending' })
    .onConflictDoNothing({ target: [saveIntentTable.userId, saveIntentTable.sourceRecordId] });

  await db
    .update(saveIntentTable)
    .set({ status: 'pending', failureCode: null, failureReason: null })
    .where(
      and(
        eq(saveIntentTable.userId, userId),
        eq(saveIntentTable.sourceRecordId, sourceRecordId),
        eq(saveIntentTable.status, 'failed'),
      ),
    );
}

/**
 * Idempotently create membership once the linked Work is readable, then mark the
 * intent completed. Returns false without touching membership when the Work is
 * missing or still processing.
 */
async function completeIntentIfWorkReadable(userId: string, sourceRecordId: string, workId: string): Promise<boolean> {
  const [work] = await db
    .select({ processingStatus: readingWorkTable.processingStatus })
    .from(readingWorkTable)
    .where(eq(readingWorkTable.id, workId))
    .limit(1);

  if (!work || !isWorkParseCompleted(work.processingStatus)) {
    return false;
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(userLibraryItemTable)
      .values({ id: randomUUID(), userId, workId })
      .onConflictDoNothing({ target: [userLibraryItemTable.userId, userLibraryItemTable.workId] });
    await tx
      .update(saveIntentTable)
      .set({ status: 'completed', failureCode: null, failureReason: null })
      .where(and(eq(saveIntentTable.userId, userId), eq(saveIntentTable.sourceRecordId, sourceRecordId)));
  });
  return true;
}

async function completePendingIntents(sourceRecordId: string, workId: string): Promise<void> {
  const intents = await db
    .select({ userId: saveIntentTable.userId })
    .from(saveIntentTable)
    .where(and(eq(saveIntentTable.sourceRecordId, sourceRecordId), eq(saveIntentTable.status, 'pending')));

  for (const intent of intents) {
    await completeIntentIfWorkReadable(intent.userId, sourceRecordId, workId);
  }
}

/**
 * Enqueue one SourceRecord-level materialization run. The id is reused while queued/active.
 * Custom BullMQ job ids must not contain `:` — hyphens separate the parts.
 */
export async function enqueueSourceRecordMaterialization(sourceRecordId: string): Promise<void> {
  const data: SourceRecordMaterializeJobData = { sourceRecordId };
  await enqueueDiscoveryImport(SOURCE_RECORD_MATERIALIZE_JOB, data, {
    jobId: `${SOURCE_RECORD_MATERIALIZE_JOB}-${sourceRecordId}`,
    removeOnComplete: true,
    removeOnFail: true,
  });
}

/**
 * Current SourceRecord → ReadingWork link. Re-read after the intent upsert so a
 * Work that became linked between the pre-upsert validation and this point is
 * still observed.
 */
async function loadCurrentSourceRecordWorkId(sourceRecordId: string): Promise<string | null> {
  const [row] = await db
    .select({ workId: sourceRecordTable.workId })
    .from(sourceRecordTable)
    .where(eq(sourceRecordTable.id, sourceRecordId))
    .limit(1);
  return row?.workId ?? null;
}

/**
 * Authenticated Save API entry point. Rejects disabled sources / unavailable
 * records / records without a selectable EPUB candidate, then either completes
 * immediately (readable Work already present) or returns `pending` and enqueues
 * the shared materialization job. Re-reading the record after upserting the
 * intent closes the late-intent race: an intent created during a fan-out still
 * sees the committed link and completes.
 */
export async function saveSourceRecordToLibrary(
  userId: string,
  sourceRecordId: string,
): Promise<SaveSourceRecordResult> {
  // Validate enabled source + available record + selectable EPUB candidate
  // before creating the intent.
  await loadSavableSourceRecord(sourceRecordId);
  await ensurePendingIntent(userId, sourceRecordId);

  // Re-read the linkage *after* the upsert. A Work linked during the intent
  // upsert window must complete this intent immediately instead of being left
  // pending for a later job; the pre-upsert read is intentionally not trusted.
  const workId = await loadCurrentSourceRecordWorkId(sourceRecordId);
  if (workId) {
    const completed = await completeIntentIfWorkReadable(userId, sourceRecordId, workId);
    if (completed) {
      return { status: 'ready', workId };
    }
  }

  try {
    await enqueueSourceRecordMaterialization(sourceRecordId);
  } catch (error) {
    // A queue that rejects the job would otherwise leave this intent pending
    // forever: persist the failure for this user so the GET reports `failed`
    // (and the client stops polling), then rethrow the original error so the
    // HTTP contract of the Save API is unchanged.
    const reason =
      cleanSaveIntentFailureReason(error instanceof Error ? error.message : '') ?? ENQUEUE_FAILURE_FALLBACK_REASON;
    await failPendingIntentForUser(userId, sourceRecordId, ENQUEUE_FAILURE_CODE, reason);
    throw error;
  }
  return { status: 'pending', workId };
}

/** Persist a failure for exactly one user's still-pending intent. */
async function failPendingIntentForUser(
  userId: string,
  sourceRecordId: string,
  failureCode: string,
  failureReason: string | null,
): Promise<void> {
  await db
    .update(saveIntentTable)
    .set({ status: 'failed', failureCode, failureReason })
    .where(
      and(
        eq(saveIntentTable.userId, userId),
        eq(saveIntentTable.sourceRecordId, sourceRecordId),
        eq(saveIntentTable.status, 'pending'),
      ),
    );
}

type StaleSaveIntentCandidate = {
  readonly userId: string;
  readonly sourceRecordId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly workId: string | null;
};

/**
 * Resolve one stale pending intent: complete it when its linked Work became
 * readable, hard-fail it once the attempt outlives the timeout deadline, or
 * re-enqueue the idempotent materialization job and refresh `updated_at` so the
 * next recovery pass waits a full re-enqueue window. A queue error during
 * re-enqueue never fails the pass — the timeout deadline still exits later.
 */
async function recoverStalePendingIntent(candidate: StaleSaveIntentCandidate, now: Date): Promise<void> {
  if (now.getTime() - candidate.updatedAt.getTime() < SAVE_INTENT_REENQUEUE_AFTER_MS) {
    return;
  }
  if (candidate.workId) {
    const completed = await completeIntentIfWorkReadable(candidate.userId, candidate.sourceRecordId, candidate.workId);
    if (completed) {
      return;
    }
  }
  if (now.getTime() - candidate.createdAt.getTime() >= SAVE_INTENT_TIMEOUT_AFTER_MS) {
    await failPendingIntentForUser(
      candidate.userId,
      candidate.sourceRecordId,
      TIMEOUT_FAILURE_CODE,
      TIMEOUT_FAILURE_REASON,
    );
    return;
  }
  try {
    await enqueueSourceRecordMaterialization(candidate.sourceRecordId);
  } catch (error) {
    saveIntentLogger.warn(
      { err: error, sourceRecordId: candidate.sourceRecordId },
      'Stale Save Intent materialize re-enqueue failed',
    );
    return;
  }
  await db
    .update(saveIntentTable)
    .set({ updatedAt: now })
    .where(
      and(
        eq(saveIntentTable.userId, candidate.userId),
        eq(saveIntentTable.sourceRecordId, candidate.sourceRecordId),
        eq(saveIntentTable.status, 'pending'),
      ),
    );
}

function stalePendingIntentConditions(cutoff: Date) {
  return [eq(saveIntentTable.status, 'pending'), lt(saveIntentTable.updatedAt, cutoff)] as const;
}

/**
 * Periodic recovery for stale pending Save Intents whose materialization job was
 * lost (Redis restart / queue flush), never picked up (worker down), or never
 * queued. Bounded scan: at most {@link SAVE_INTENT_RECOVERY_SCAN_LIMIT} intents
 * older than {@link SAVE_INTENT_REENQUEUE_AFTER_MS} per pass, oldest first.
 * Called from the full worker's dispatch timer.
 */
export async function recoverStaleSaveIntents(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - SAVE_INTENT_REENQUEUE_AFTER_MS);
  const candidates = await db
    .select({
      userId: saveIntentTable.userId,
      sourceRecordId: saveIntentTable.sourceRecordId,
      createdAt: saveIntentTable.createdAt,
      updatedAt: saveIntentTable.updatedAt,
      workId: sourceRecordTable.workId,
    })
    .from(saveIntentTable)
    .leftJoin(sourceRecordTable, eq(sourceRecordTable.id, saveIntentTable.sourceRecordId))
    .where(and(...stalePendingIntentConditions(cutoff)))
    .orderBy(asc(saveIntentTable.updatedAt))
    .limit(SAVE_INTENT_RECOVERY_SCAN_LIMIT);

  for (const candidate of candidates) {
    await recoverStalePendingIntent(candidate, now);
  }
}

/**
 * Lazy recovery for exactly one owner-scoped intent, used by
 * `GET /api/library/source-records/:id` before the status read. Point lookup on
 * `(user_id, source_record_id)` — never a table scan — so a fresh, completed, or
 * absent intent costs one indexed query and stays a no-op.
 */
export async function recoverStaleSaveIntent(userId: string, sourceRecordId: string, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - SAVE_INTENT_REENQUEUE_AFTER_MS);
  const [candidate] = await db
    .select({
      userId: saveIntentTable.userId,
      sourceRecordId: saveIntentTable.sourceRecordId,
      createdAt: saveIntentTable.createdAt,
      updatedAt: saveIntentTable.updatedAt,
      workId: sourceRecordTable.workId,
    })
    .from(saveIntentTable)
    .leftJoin(sourceRecordTable, eq(sourceRecordTable.id, saveIntentTable.sourceRecordId))
    .where(
      and(
        eq(saveIntentTable.userId, userId),
        eq(saveIntentTable.sourceRecordId, sourceRecordId),
        ...stalePendingIntentConditions(cutoff),
      ),
    )
    .limit(1);
  if (!candidate) {
    return;
  }
  await recoverStalePendingIntent(candidate, now);
}

/**
 * Owner-scoped Save Intent status for the Discover refresh/recovery loop.
 *
 * The intent row plus the linked Work's readiness decide the reported status;
 * a linked `work_id` alone never means `ready`, because materialization links
 * the Work before parsing finishes. Another user's intent is never readable
 * here, a record without this user's intent reports `none`, and an unknown
 * record is not found. Disabled/unavailable records still report the caller's
 * own existing state so a saved item never loses its status mid-import.
 *
 * A pending intent whose linked Work already became readable completes here
 * (same idempotent path as POST); a pending intent whose linked Work failed is
 * persisted as failed with a cleaned reason so the existing POST retry can
 * revive it.
 *
 * Before the status read, this owner-scoped read runs one lazy recovery pass for
 * this exact intent: a stale pending row (lost materialization job, stopped
 * worker, failed enqueue) is re-enqueued, completed, or timed out instead of
 * reporting `pending` forever to a polling client.
 */
export async function readSourceRecordSaveStatus(
  userId: string,
  sourceRecordId: string,
): Promise<SourceRecordSaveStatus> {
  const [record] = await db
    .select({ workId: sourceRecordTable.workId })
    .from(sourceRecordTable)
    .where(eq(sourceRecordTable.id, sourceRecordId))
    .limit(1);
  if (!record) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }

  await recoverStaleSaveIntent(userId, sourceRecordId);

  const [intent] = await db
    .select({
      status: saveIntentTable.status,
      failureReason: saveIntentTable.failureReason,
      updatedAt: saveIntentTable.updatedAt,
    })
    .from(saveIntentTable)
    .where(and(eq(saveIntentTable.userId, userId), eq(saveIntentTable.sourceRecordId, sourceRecordId)))
    .limit(1);

  if (!intent) {
    return { status: 'none', workId: record.workId, failureReason: null };
  }
  if (intent.status === 'completed') {
    return { status: 'ready', workId: record.workId, failureReason: null };
  }
  if (intent.status === 'failed') {
    return { status: 'failed', workId: record.workId, failureReason: intent.failureReason };
  }

  if (!record.workId) {
    return { status: 'pending', workId: null, failureReason: null };
  }

  const [work] = await db
    .select({
      processingStatus: readingWorkTable.processingStatus,
      originMeta: readingWorkTable.originMeta,
      updatedAt: readingWorkTable.updatedAt,
    })
    .from(readingWorkTable)
    .where(eq(readingWorkTable.id, record.workId))
    .limit(1);
  if (!work) {
    return { status: 'pending', workId: record.workId, failureReason: null };
  }
  if (isWorkParseCompleted(work.processingStatus)) {
    const completed = await completeIntentIfWorkReadable(userId, sourceRecordId, record.workId);
    if (completed) {
      return { status: 'ready', workId: record.workId, failureReason: null };
    }
    return { status: 'pending', workId: record.workId, failureReason: null };
  }
  // A retry revives the intent before its queued worker reserves the Work. Its
  // older failure must not fail the new intent and stop the client's polling.
  if (work.processingStatus === 'failed' && work.updatedAt > intent.updatedAt) {
    const reason =
      cleanSaveIntentFailureReason(String(work.originMeta?.lastError ?? '')) ?? 'Content processing failed';
    const failed = await db
      .update(saveIntentTable)
      .set({ status: 'failed', failureCode: 'processing_failed', failureReason: reason })
      .where(
        and(
          eq(saveIntentTable.userId, userId),
          eq(saveIntentTable.sourceRecordId, sourceRecordId),
          eq(saveIntentTable.status, 'pending'),
          lte(saveIntentTable.updatedAt, work.updatedAt),
        ),
      )
      .returning({ id: saveIntentTable.id });
    if (failed.length > 0) {
      return { status: 'failed', workId: record.workId, failureReason: reason };
    }
  }
  return { status: 'pending', workId: record.workId, failureReason: null };
}

/** Fan out a ready import to every pending intent of its SourceRecord. */
export async function fanOutReadySaveIntentsForSourceRecord(sourceRecordId: string): Promise<void> {
  const [record] = await db
    .select({ workId: sourceRecordTable.workId })
    .from(sourceRecordTable)
    .where(eq(sourceRecordTable.id, sourceRecordId))
    .limit(1);

  if (!record?.workId) {
    return;
  }
  await completePendingIntents(sourceRecordId, record.workId);
}

/** Fan out a parse-completed Work to the pending intents of the SourceRecord linked to it. */
export async function fanOutReadySaveIntentsForWork(workId: string): Promise<void> {
  const [record] = await db
    .select({ id: sourceRecordTable.id })
    .from(sourceRecordTable)
    .where(eq(sourceRecordTable.workId, workId))
    .limit(1);

  if (!record) {
    return;
  }
  await completePendingIntents(record.id, workId);
}

/** Mark every still-pending intent of a SourceRecord failed with a cleaned reason. */
export async function failPendingSaveIntents(sourceRecordId: string, failure: SaveIntentFailure): Promise<void> {
  await db
    .update(saveIntentTable)
    .set({ status: 'failed', failureCode: failure.code, failureReason: failure.reason })
    .where(and(eq(saveIntentTable.sourceRecordId, sourceRecordId), eq(saveIntentTable.status, 'pending')));
}

/** Reason length cap keeps persisted failure text short and user-visible. */
const FAILURE_REASON_MAX_CHARS = 200;

/**
 * Normalize a failure reason: single-line, trimmed, capped, and free of control
 * characters. Returns null when nothing useful remains.
 */
export function cleanSaveIntentFailureReason(message: string): string | null {
  const cleaned = Array.from(message)
    .map((char) => {
      const code = char.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? ' ' : char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return null;
  }
  return cleaned.length > FAILURE_REASON_MAX_CHARS ? `${cleaned.slice(0, FAILURE_REASON_MAX_CHARS - 1)}…` : cleaned;
}

type LinkedWorkParseState = {
  readonly sourceRecordId: string;
  readonly failedAtParse: boolean;
};

/**
 * Resolve the SourceRecord linked to a Work and whether the Work is in the
 * recorded parse-failure state. Returns null for unlinked (Personal) Works, so
 * every parse-failure hook is a no-op for them.
 */
async function loadLinkedWorkParseState(workId: string): Promise<LinkedWorkParseState | null> {
  const [row] = await db
    .select({
      processingStatus: readingWorkTable.processingStatus,
      originMeta: readingWorkTable.originMeta,
      sourceRecordId: sourceRecordTable.id,
    })
    .from(readingWorkTable)
    .innerJoin(sourceRecordTable, eq(sourceRecordTable.workId, readingWorkTable.id))
    .where(eq(readingWorkTable.id, workId))
    .limit(1);

  if (!row) {
    return null;
  }
  return {
    sourceRecordId: row.sourceRecordId,
    failedAtParse: row.processingStatus === 'failed' && row.originMeta?.failedStep === 'parse',
  };
}

/**
 * Before a BullMQ retry re-parses a previously failed linked Work, return its
 * failed intents to `pending` so a successful retry can complete them. Without
 * this a transient parse failure followed by a successful retry would leave the
 * user's save permanently failed even though the import became readable.
 */
export async function reviveFailedSaveIntentsForWorkParseRetry(workId: string): Promise<void> {
  const state = await loadLinkedWorkParseState(workId);
  if (!state?.failedAtParse) {
    return;
  }
  await db
    .update(saveIntentTable)
    .set({ status: 'pending', failureCode: null, failureReason: null })
    .where(and(eq(saveIntentTable.sourceRecordId, state.sourceRecordId), eq(saveIntentTable.status, 'failed')));
}

/**
 * Propagate a recorded parse failure of a SourceRecord-linked Work to its
 * pending save intents. Unlinked (Personal) Works are ignored so their behavior
 * is unchanged; membership is never created here.
 */
export async function failSaveIntentsForWorkParseFailure(workId: string, failure: SaveIntentFailure): Promise<void> {
  const state = await loadLinkedWorkParseState(workId);
  if (!state?.failedAtParse) {
    return;
  }
  await failPendingSaveIntents(state.sourceRecordId, failure);
}
