import { z } from 'zod';

import { emptyToUndefined } from '../pagination/index.ts';

/** Parse `tag` query values — comma-separated and/or repeated params — into stable tag ids. */
export function parseCatalogTagIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const ids: string[] = [];
  const push = (raw: string) => {
    for (const piece of raw.split(',')) {
      const id = piece.trim();
      if (id) {
        ids.push(id);
      }
    }
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') {
        push(entry);
      }
    }
  } else if (typeof value === 'string') {
    push(value);
  }

  if (ids.length === 0) {
    return undefined;
  }

  return [...new Set(ids)];
}

export const catalogTagIdsQuerySchema = z.preprocess(parseCatalogTagIds, z.array(z.string().trim().min(1)).optional());

export const catalogCategoryIdQuerySchema = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());
