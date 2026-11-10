import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import { sourceRecordPublicClassificationState as stateTable } from '@gloaming/db/schema';

import { db, type DbTransaction } from '@/infra/db';

export type PublicClassificationStateRow = typeof stateTable.$inferSelect;

/** One queued evidence fingerprint for a SourceRecord, decided during metadata sync. */
export type PublicClassificationEvidenceCandidate = {
  sourceRecordId: string;
  fingerprint: string;
  /** True when no prior SourceRecord row existed for this external id. */
  isNew: boolean;
  /** Fingerprint of the pre-upsert evidence; null when the record is new. */
  previousFingerprint: string | null;
};

export type DuePublicClassification = {
  sourceRecordId: string;
  fingerprint: string;
};

/** Current durable classification state for one SourceRecord, if any. */
export async function loadPublicClassificationState(
  sourceRecordId: string,
): Promise<PublicClassificationStateRow | null> {
  const [row] = await db.select().from(stateTable).where(eq(stateTable.sourceRecordId, sourceRecordId)).limit(1);
  return row ?? null;
}

/**
 * Decide and persist classification state for one upserted metadata batch.
 *
 * - New evidence that differs from the stored fingerprint resets the state and
 *   becomes due now, superseding a stale deferred fingerprint.
 * - A pre-existing record whose evidence did not change is baselined as already
 *   completed so an ordinary repeated sync never reprocesses the corpus.
 * - Unchanged evidence keeps its stored deferral/retry time untouched.
 *
 * The touched rows are locked in one transaction so a concurrent classification
 * outcome cannot be overwritten by the sync decision. Metadata sync supplies its
 * batch transaction so source evidence and this decision commit together.
 */
export async function recordPublicClassificationEvidenceCandidates(
  candidates: PublicClassificationEvidenceCandidate[],
  now: Date,
  executor?: DbTransaction,
): Promise<number> {
  if (candidates.length === 0) return 0;

  const persist = async (tx: DbTransaction): Promise<number> => {
    const ids = candidates.map((candidate) => candidate.sourceRecordId);
    const existingRows = await tx
      .select()
      .from(stateTable)
      .where(inArray(stateTable.sourceRecordId, ids))
      .for('update');
    const existingById = new Map(existingRows.map((row) => [row.sourceRecordId, row]));

    const upserts: Array<typeof stateTable.$inferInsert> = [];
    for (const candidate of candidates) {
      const existing = existingById.get(candidate.sourceRecordId);
      if (existing) {
        if (existing.evidenceFingerprint === candidate.fingerprint) {
          // Same evidence: keep the completed/deferred decision already stored.
          continue;
        }
      } else if (!candidate.isNew && candidate.previousFingerprint === candidate.fingerprint) {
        // Pre-existing record with unchanged evidence: baseline as handled.
        upserts.push({
          sourceRecordId: candidate.sourceRecordId,
          evidenceFingerprint: candidate.fingerprint,
          completedFingerprint: candidate.fingerprint,
          nextAttemptAt: now,
          lastDeferredReason: null,
          retryCount: 0,
        });
        continue;
      }

      upserts.push({
        sourceRecordId: candidate.sourceRecordId,
        evidenceFingerprint: candidate.fingerprint,
        completedFingerprint: null,
        nextAttemptAt: now,
        lastDeferredReason: null,
        retryCount: 0,
      });
    }

    if (upserts.length === 0) return 0;
    await tx
      .insert(stateTable)
      .values(upserts)
      .onConflictDoUpdate({
        target: stateTable.sourceRecordId,
        set: {
          evidenceFingerprint: sql`excluded.evidence_fingerprint`,
          completedFingerprint: sql`excluded.completed_fingerprint`,
          nextAttemptAt: sql`excluded.next_attempt_at`,
          lastDeferredReason: sql`excluded.last_deferred_reason`,
          retryCount: sql`excluded.retry_count`,
          updatedAt: now,
        },
      });
    return upserts.length;
  };
  return executor ? persist(executor) : db.transaction(persist);
}

/** Rows whose current evidence has not completed and whose retry gate has passed. */
export async function loadDuePublicClassifications(now: Date, limit: number): Promise<DuePublicClassification[]> {
  return db
    .select({
      sourceRecordId: stateTable.sourceRecordId,
      fingerprint: stateTable.evidenceFingerprint,
    })
    .from(stateTable)
    .where(
      and(
        sql`${stateTable.completedFingerprint} IS DISTINCT FROM ${stateTable.evidenceFingerprint}`,
        lte(stateTable.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(stateTable.nextAttemptAt), asc(stateTable.sourceRecordId))
    .limit(limit);
}

/**
 * Compare-and-set completion for one queued fingerprint. Returns false when the
 * stored evidence was superseded by newer metadata, so a stale run can never
 * mark newer evidence complete.
 */
export async function completePublicClassificationState(input: {
  sourceRecordId: string;
  fingerprint: string;
  now: Date;
}): Promise<boolean> {
  const result = await db
    .update(stateTable)
    .set({
      completedFingerprint: input.fingerprint,
      nextAttemptAt: input.now,
      lastDeferredReason: null,
      retryCount: 0,
      updatedAt: input.now,
    })
    .where(
      and(eq(stateTable.sourceRecordId, input.sourceRecordId), eq(stateTable.evidenceFingerprint, input.fingerprint)),
    );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Compare-and-set deferral for one queued fingerprint. Returns false when the
 * stored evidence was superseded, so a stale deferral never overwrites newer
 * metadata state.
 */
export async function deferPublicClassificationState(input: {
  sourceRecordId: string;
  fingerprint: string;
  reason: string;
  nextAttemptAt: Date;
  now: Date;
}): Promise<boolean> {
  const result = await db
    .update(stateTable)
    .set({
      nextAttemptAt: input.nextAttemptAt,
      lastDeferredReason: input.reason,
      retryCount: sql`${stateTable.retryCount} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(eq(stateTable.sourceRecordId, input.sourceRecordId), eq(stateTable.evidenceFingerprint, input.fingerprint)),
    );
  return (result.rowCount ?? 0) > 0;
}
