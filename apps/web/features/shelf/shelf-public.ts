import { type ShelfData, shelfDataSchema, type ShelfItem } from '@gloaming/shared/shelf';

import { apiRequest } from '@/lib/api-request';

/** Cross-feature public entry for shelf data. No React Query or page components. */
export async function getShelf(init?: { signal?: AbortSignal }): Promise<ShelfData> {
  return apiRequest('/api/shelf', {
    schema: shelfDataSchema,
    signal: init?.signal,
  });
}

export function buildShelfItemMap(data: ShelfData): Map<string, ShelfItem> {
  const map = new Map<string, ShelfItem>();
  if (data.current) {
    map.set(data.current.work.id, data.current);
  }
  for (const item of data.items) {
    map.set(item.work.id, item);
  }
  return map;
}
