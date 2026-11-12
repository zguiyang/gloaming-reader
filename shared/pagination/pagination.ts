import { z } from 'zod';

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export const DEFAULT_PAGE = 1 as const;
export const DEFAULT_PAGE_SIZE = 10 as const;
export const DEFAULT_SORT_ORDER = 'desc' as const satisfies SortOrder;

/** Treat missing / blank query values as undefined so Zod defaults apply. */
export function emptyToUndefined(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
}

function coercedPositiveInt(defaultValue: number) {
  return z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).default(defaultValue));
}

/**
 * Shared list pagination + sort-order query fields.
 * `sortBy` is domain-specific — compose via `createSortByQuerySchema`.
 */
export const paginationQuerySchema = z.object({
  page: coercedPositiveInt(DEFAULT_PAGE),
  pageSize: coercedPositiveInt(DEFAULT_PAGE_SIZE),
  sortOrder: z.preprocess(emptyToUndefined, z.enum(SORT_ORDERS).default(DEFAULT_SORT_ORDER)),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Build a `sortBy` query field with allowed values and a default. */
export function createSortByQuerySchema<const T extends readonly [string, ...string[]]>(
  allowed: T,
  defaultValue: T[number],
) {
  return z.preprocess(emptyToUndefined, z.enum(allowed).default(defaultValue));
}

export const paginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  sortBy: z.string().min(1),
  sortOrder: z.enum(SORT_ORDERS),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export function buildPaginationMeta(input: {
  page: number;
  pageSize: number;
  total: number;
  sortBy: string;
  sortOrder: SortOrder;
}): PaginationMeta {
  const totalPages = input.pageSize > 0 ? Math.ceil(input.total / input.pageSize) : 0;
  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    totalPages,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
  };
}
