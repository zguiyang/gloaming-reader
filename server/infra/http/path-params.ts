import { z } from 'zod';

import { ValidationFailedError } from '@/server/shared/errors/app-error';

/**
 * Database ids, registry keys and opaque handles that appear as path segments.
 * They are URL-safe tokens, so anything else (percent-escapes, whitespace,
 * path separators, oversized values) is rejected before it reaches a query.
 */
const pathIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/, 'must be a URL-safe identifier');

/**
 * Parse one dynamic route segment. Throws a 400 through the shared error
 * contract, so callers keep using `catch → jsonFromThrown`.
 */
export function pathId(value: string, field: string): string {
  const parsed = pathIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationFailedError([{ path: field, message: parsed.error.issues[0]?.message }]);
  }
  return parsed.data;
}
