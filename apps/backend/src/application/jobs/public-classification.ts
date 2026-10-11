import { classifySourceRecordForPublicCategories } from '@/domains/discovery/categories/classification';
import type {
  PublicClassificationCommandResult,
  PublicClassificationDeferredReason,
} from '@/domains/discovery/categories/classification-contract';
import {
  completePublicClassification,
  deferPublicClassification,
  getPublicClassificationVerdict,
  JOB_PUBLIC_CLASSIFICATION,
  resolvePublicClassificationRetryAt,
} from '@/domains/discovery/categories/incremental-classification';
import { rootLogger } from '@/infra/logging/logger';

export { JOB_PUBLIC_CLASSIFICATION };

export type PublicClassificationJobData = {
  sourceRecordId: string;
  fingerprint: string;
};

export type PublicClassificationJobResult =
  | { status: 'completed' }
  | { status: 'deferred'; reason: PublicClassificationDeferredReason }
  | { status: 'skipped'; reason: string };

const logger = rootLogger.child({ module: 'PublicClassificationJob' });

/**
 * One incremental public-classification run for one queued evidence fingerprint.
 *
 * The job calls the PC-03 command at most once (which itself caps AI attempts at
 * two) and never lets BullMQ retry multiply calls: the queue attempts is 1 and
 * any deferred result is stored for a later dispatcher pass. A completed or
 * superseded fingerprint is a no-op, so duplicate jobs never call AI again.
 */
export async function processPublicClassification(
  data: PublicClassificationJobData,
): Promise<PublicClassificationJobResult> {
  const verdict = await getPublicClassificationVerdict({
    sourceRecordId: data.sourceRecordId,
    fingerprint: data.fingerprint,
    now: new Date(),
  });
  if (verdict !== 'eligible') {
    return { status: 'skipped', reason: verdict };
  }

  let result: PublicClassificationCommandResult;
  try {
    result = await classifySourceRecordForPublicCategories(data.sourceRecordId);
  } catch (error) {
    // Unexpected failure: keep the record retryable, then surface the failure.
    await deferPublicClassification({
      sourceRecordId: data.sourceRecordId,
      fingerprint: data.fingerprint,
      reason: 'transient_failure',
      nextAttemptAt: resolvePublicClassificationRetryAt(
        { status: 'deferred', reason: 'transient_failure' },
        new Date(),
      ),
    });
    logger.warn({ err: error, sourceRecordId: data.sourceRecordId }, 'Public classification run failed unexpectedly');
    throw error;
  }

  if (result.status === 'completed') {
    const applied = await completePublicClassification({
      sourceRecordId: data.sourceRecordId,
      fingerprint: data.fingerprint,
    });
    return applied ? { status: 'completed' } : { status: 'skipped', reason: 'superseded' };
  }

  if (result.status === 'deferred') {
    await deferPublicClassification({
      sourceRecordId: data.sourceRecordId,
      fingerprint: data.fingerprint,
      reason: result.reason,
      nextAttemptAt: resolvePublicClassificationRetryAt(result, new Date()),
    });
    return { status: 'deferred', reason: result.reason };
  }

  await deferPublicClassification({
    sourceRecordId: data.sourceRecordId,
    fingerprint: data.fingerprint,
    reason: `skipped:${result.reason}`,
    nextAttemptAt: resolvePublicClassificationRetryAt(result, new Date()),
  });
  return { status: 'skipped', reason: result.reason };
}
