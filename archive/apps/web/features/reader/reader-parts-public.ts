import { type ReaderPartsData, readerPartsDataSchema } from '@gloaming/shared/reader';

import { apiRequest } from '@/lib/api-request';

/** Cross-feature public entry for reader work parts. No React Query or view models. */
export async function getWorkParts(workId: string, init?: { signal?: AbortSignal }): Promise<ReaderPartsData> {
  return apiRequest(`/api/reader/works/${encodeURIComponent(workId)}/parts`, {
    schema: readerPartsDataSchema,
    signal: init?.signal,
  });
}
