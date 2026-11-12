import { createHash } from 'node:crypto';

import type {
  PublicClassificationDeferredReason,
  PublicClassificationSkippedReason,
} from '@/domains/discovery/categories/classification-contract';
import {
  completePublicClassificationState,
  deferPublicClassificationState,
  loadDuePublicClassifications,
  loadPublicClassificationState,
  type PublicClassificationEvidenceCandidate,
  recordPublicClassificationEvidenceCandidates,
} from '@/domains/discovery/categories/incremental-classification-repository';
import type { DbTransaction } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';
import { enqueuePublicClassification } from '@/infra/queue';

export const JOB_PUBLIC_CLASSIFICATION = 'public-classification';

/** Bounded number of records enqueued per dispatcher pass to keep the outbox resumable and cheap. */
export const PUBLIC_CLASSIFICATION_DISPATCH_BATCH_LIMIT = 25;

export const PUBLIC_CLASSIFICATION_BUSY_RETRY_MS = 2 * 60_000;
export const PUBLIC_CLASSIFICATION_PROVIDER_RETRY_MS = 15 * 60_000;
export const PUBLIC_CLASSIFICATION_TRANSIENT_RETRY_MS = 15 * 60_000;
export const PUBLIC_CLASSIFICATION_INELIGIBLE_RETRY_MS = 6 * 60 * 60_000;
export const PUBLIC_CLASSIFICATION_LIMIT_RETRY_MS = 24 * 60 * 60_000;

const logger = rootLogger.child({ module: 'IncrementalPublicClassification' });

/**
 * The bounded SourceRecord evidence a classification fingerprint is computed
 * from. It mirrors the inputs PC-03 sends to the model; raw `sourceMeta` is read
 * only and never written.
 */
export type PublicClassificationEvidence = {
  title: string;
  authors: string[];
  languages: string[];
  description: string | null;
  subjects: string[];
  bookshelves: string[];
};

export type { PublicClassificationEvidenceCandidate };

/** Stable, order-preserving fingerprint of the six classification evidence fields. */
export function computePublicClassificationFingerprint(evidence: PublicClassificationEvidence): string {
  const canonical = JSON.stringify([
    evidence.title,
    evidence.authors,
    evidence.languages,
    evidence.description,
    evidence.subjects,
    evidence.bookshelves,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Persist the fingerprint decision for an upserted metadata batch. This is the
 * only sync-side classification write; it is pure database work so a failing
 * queue or provider can never affect source sync.
 */
export async function recordPublicClassificationEvidenceBatch(
  candidates: PublicClassificationEvidenceCandidate[],
  now: Date = new Date(),
  executor?: DbTransaction,
): Promise<number> {
  return recordPublicClassificationEvidenceCandidates(candidates, now, executor);
}

/** Earliest next attempt after one PC-03 outcome; bounded so retries are never a rapid loop. */
export function resolvePublicClassificationRetryAt(
  outcome:
    | { status: 'deferred'; reason: PublicClassificationDeferredReason }
    | { status: 'skipped'; reason: PublicClassificationSkippedReason },
  now: Date,
): Date {
  if (outcome.status === 'deferred') {
    switch (outcome.reason) {
      case 'busy':
        return new Date(now.getTime() + PUBLIC_CLASSIFICATION_BUSY_RETRY_MS);
      case 'provider_unavailable':
        return new Date(now.getTime() + PUBLIC_CLASSIFICATION_PROVIDER_RETRY_MS);
      case 'transient_failure':
        return new Date(now.getTime() + PUBLIC_CLASSIFICATION_TRANSIENT_RETRY_MS);
    }
  }
  switch (outcome.reason) {
    case 'source_record_not_found':
    case 'source_record_not_eligible':
      return new Date(now.getTime() + PUBLIC_CLASSIFICATION_INELIGIBLE_RETRY_MS);
    case 'candidate_limit_exceeded':
    case 'input_limit_exceeded':
      return new Date(now.getTime() + PUBLIC_CLASSIFICATION_LIMIT_RETRY_MS);
  }
}

export type PublicClassificationVerdict = 'eligible' | 'completed' | 'superseded' | 'not_due' | 'missing';

/**
 * Whether a queued fingerprint may invoke PC-03 now. A completed fingerprint is
 * never re-run, a superseded fingerprint is dropped, and a deferred fingerprint
 * stays retryable only after its gate passes.
 */
export async function getPublicClassificationVerdict(input: {
  sourceRecordId: string;
  fingerprint: string;
  now: Date;
}): Promise<PublicClassificationVerdict> {
  const state = await loadPublicClassificationState(input.sourceRecordId);
  if (!state) return 'missing';
  if (state.evidenceFingerprint !== input.fingerprint) return 'superseded';
  if (state.completedFingerprint === input.fingerprint) return 'completed';
  if (state.nextAttemptAt.getTime() > input.now.getTime()) return 'not_due';
  return 'eligible';
}

/** Persist one completed fingerprint; returns false when newer evidence superseded it. */
export async function completePublicClassification(input: {
  sourceRecordId: string;
  fingerprint: string;
}): Promise<boolean> {
  return completePublicClassificationState({ ...input, now: new Date() });
}

/** Persist one deferral with its bounded retry time; returns false when superseded. */
export async function deferPublicClassification(input: {
  sourceRecordId: string;
  fingerprint: string;
  reason: string;
  nextAttemptAt: Date;
}): Promise<boolean> {
  return deferPublicClassificationState({ ...input, now: new Date() });
}

/**
 * Outbox pass: enqueue due fingerprints with a stable id and single BullMQ
 * attempt. A removed job can never lose track because the state row, not the
 * queue, owns idempotency. Enqueue failure is logged and leaves the row due.
 */
export async function dispatchDuePublicClassifications(
  now: Date = new Date(),
  limit: number = PUBLIC_CLASSIFICATION_DISPATCH_BATCH_LIMIT,
): Promise<number> {
  const due = await loadDuePublicClassifications(now, limit);
  let enqueued = 0;
  for (const row of due) {
    try {
      await enqueuePublicClassification(
        JOB_PUBLIC_CLASSIFICATION,
        { sourceRecordId: row.sourceRecordId, fingerprint: row.fingerprint },
        {
          attempts: 1,
          jobId: `${JOB_PUBLIC_CLASSIFICATION}:${row.sourceRecordId}:${row.fingerprint}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      enqueued += 1;
    } catch (error) {
      logger.warn(
        { err: error, sourceRecordId: row.sourceRecordId },
        'Failed to enqueue incremental public classification; retry on next dispatch pass',
      );
    }
  }
  return enqueued;
}
