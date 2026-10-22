import { putObject } from '@/infra/storage';

const SEGMENT_MIME = 'audio/mpeg';

/** Persist one synthesized segment under its derived storage key. */
export async function putSegmentObject(storageKey: string, bytes: Buffer): Promise<void> {
  await putObject({ key: storageKey, body: bytes, contentType: SEGMENT_MIME });
}
