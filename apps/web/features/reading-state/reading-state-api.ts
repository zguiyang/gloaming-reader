import { type ReadingState, readingStateSchema, type UpdateReadingStateBody } from '@gloaming/shared/reader';

import { apiRequest, ApiRequestError } from '@/lib/api-request';

export function withExpectedReadingStateRevision(
  body: UpdateReadingStateBody,
  revision: number | undefined,
): UpdateReadingStateBody {
  if (body.expectedRevision != null || revision == null) {
    return body;
  }
  return { ...body, expectedRevision: revision };
}

export function isReadingStateRevisionConflict(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409;
}

export async function patchReadingState(
  workId: string,
  body: UpdateReadingStateBody,
  init?: { signal?: AbortSignal },
): Promise<ReadingState> {
  return apiRequest(`/api/reader/works/${encodeURIComponent(workId)}/state`, {
    method: 'PATCH',
    schema: readingStateSchema,
    json: body,
    signal: init?.signal,
  });
}

/** Silent shelf add — creates 0% state without opening reader. */
export async function addWorkToShelf(workId: string): Promise<void> {
  await patchReadingState(workId, { action: 'add_to_shelf' });
}
