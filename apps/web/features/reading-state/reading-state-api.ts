import {
  type ReadingAnchor,
  type ReadingState,
  readingStateSchema,
  type UpdateReadingStateBody,
} from '@gloaming/shared/reader';

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

/**
 * Persist a within-chapter scroll position. Intentionally bypasses the shared
 * state mutation: it must not touch the React Query state cache, the chapter
 * progress ratio, or Library/Book Detail caches.
 */
export async function saveReadingAnchor(
  workId: string,
  anchor: ReadingAnchor,
  init?: { keepalive?: boolean },
): Promise<ReadingState> {
  return apiRequest(`/api/reader/works/${encodeURIComponent(workId)}/state`, {
    method: 'PATCH',
    schema: readingStateSchema,
    json: { action: 'save_position', anchor } satisfies UpdateReadingStateBody,
    keepalive: init?.keepalive,
  });
}
