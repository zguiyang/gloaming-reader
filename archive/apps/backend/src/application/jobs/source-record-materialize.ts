import { materializeSourceRecord, SourceRecordMaterializationError } from '@/domains/discovery/materialization';
import { GutenbergEpubDownloadError } from '@/domains/discovery/materialization/download';
import { EpubCandidateSelectionError } from '@/domains/discovery/materialization/epub-candidate';
import {
  cleanSaveIntentFailureReason,
  failPendingSaveIntents,
  fanOutReadySaveIntentsForSourceRecord,
  type SaveIntentFailure,
  SOURCE_RECORD_MATERIALIZE_JOB,
  type SourceRecordMaterializeJobData,
} from '@/domains/library/save-intent';
import { NotFoundError } from '@/shared/errors/app-error';

export const JOB_SOURCE_RECORD_MATERIALIZE = SOURCE_RECORD_MATERIALIZE_JOB;

export type { SourceRecordMaterializeJobData };

/** Map an import failure onto a stable, short code plus a cleaned reason. */
export function classifyMaterializationFailure(error: unknown): SaveIntentFailure {
  if (error instanceof SourceRecordMaterializationError) {
    return { code: error.code, reason: cleanSaveIntentFailureReason(error.message) };
  }
  if (error instanceof EpubCandidateSelectionError) {
    return { code: 'no_epub_candidate', reason: cleanSaveIntentFailureReason(error.message) };
  }
  if (error instanceof GutenbergEpubDownloadError) {
    return { code: `download_${error.code}`, reason: cleanSaveIntentFailureReason(error.message) };
  }
  return { code: 'materialization_failed', reason: null };
}

/**
 * Materialize one SourceRecord, then fan out its ready import to all pending save
 * intents. A failed run marks its pending intents failed (never creating
 * membership) and is re-thrown so the queue records the failure.
 */
export async function processSourceRecordMaterialize(
  data: SourceRecordMaterializeJobData,
): Promise<{ status: string }> {
  try {
    const result = await materializeSourceRecord(data.sourceRecordId);
    if (result.materializationStatus === 'ready') {
      await fanOutReadySaveIntentsForSourceRecord(data.sourceRecordId);
    }
    return { status: result.materializationStatus };
  } catch (error) {
    // A missing SourceRecord already cascaded its intents away; nothing to fail.
    if (error instanceof NotFoundError) {
      throw error;
    }
    await failPendingSaveIntents(data.sourceRecordId, classifyMaterializationFailure(error));
    throw error;
  }
}
