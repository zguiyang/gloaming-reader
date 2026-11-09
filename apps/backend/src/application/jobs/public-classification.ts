import type { PublicClassificationDeferredReason } from '@/domains/discovery/categories/classification-contract';
import {
  completePublicClassification,
  getPublicClassificationVerdict,
  JOB_PUBLIC_CLASSIFICATION,
} from '@/domains/discovery/categories/incremental-classification';
export { JOB_PUBLIC_CLASSIFICATION };

export type PublicClassificationJobData = {
  sourceRecordId: string;
  fingerprint: string;
};

export type PublicClassificationJobResult =
  | { status: 'completed' }
  | { status: 'deferred'; reason: PublicClassificationDeferredReason }
  | { status: 'skipped'; reason: string };

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

  const applied = await completePublicClassification({
    sourceRecordId: data.sourceRecordId,
    fingerprint: data.fingerprint,
  });
  return applied ? { status: 'skipped', reason: 'shelf_derived_only' } : { status: 'skipped', reason: 'superseded' };
}
