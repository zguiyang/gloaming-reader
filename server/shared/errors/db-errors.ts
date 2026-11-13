/**
 * Detect Postgres `unique_violation` (23505) on a driver error.
 *
 * The driver may surface `code` directly or nest it under `cause`, so both are
 * probed. Domain code uses this to map a duplicate-key write onto the owning
 * conflict error instead of letting it escape as an unhandled 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return (
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    error.cause.code === '23505'
  );
}
