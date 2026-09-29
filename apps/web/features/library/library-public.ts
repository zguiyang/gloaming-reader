import { type LibraryData, libraryDataSchema, type LibraryItem } from '@gloaming/shared/library';

import { apiRequest } from '@/lib/api-request';

/** Cross-feature public entry for Library membership and Continue Reading data. */
export async function getLibrary(init?: { signal?: AbortSignal }): Promise<LibraryData> {
  return apiRequest('/api/library', {
    schema: libraryDataSchema,
    signal: init?.signal,
  });
}

export function buildLibraryItemMap(data: LibraryData): Map<string, LibraryItem> {
  const map = new Map<string, LibraryItem>();
  for (const item of data.items) {
    map.set(item.work.id, item);
  }
  return map;
}
