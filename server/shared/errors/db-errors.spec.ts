import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from '@/server/shared/errors/db-errors';

describe('isUniqueViolation', () => {
  it('detects a driver-level 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('detects 23505 nested under cause', () => {
    expect(isUniqueViolation(new Error('insert failed', { cause: { code: '23505' } }))).toBe(true);
  });

  it('ignores other postgres codes and non-errors', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation({ code: 'ECONNRESET' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
