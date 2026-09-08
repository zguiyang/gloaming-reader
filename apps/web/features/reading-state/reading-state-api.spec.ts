import { describe, expect, it } from 'vitest';

import {
  isReadingStateRevisionConflict,
  withExpectedReadingStateRevision,
} from '@/features/reading-state/reading-state-api';
import { ApiRequestError } from '@/lib/api-request';

describe('reading state revision handling', () => {
  it('uses the cached revision when a command does not provide one', () => {
    expect(withExpectedReadingStateRevision({ action: 'navigate', partId: 'p2' }, 4)).toEqual({
      action: 'navigate',
      partId: 'p2',
      expectedRevision: 4,
    });
  });

  it('preserves an explicit revision and leaves create commands unchanged', () => {
    const explicit = { action: 'navigate' as const, partId: 'p2', expectedRevision: 2 };
    expect(withExpectedReadingStateRevision(explicit, 4)).toBe(explicit);
    expect(withExpectedReadingStateRevision({ action: 'open' }, undefined)).toEqual({ action: 'open' });
  });

  it('identifies only HTTP 409 state conflicts', () => {
    expect(isReadingStateRevisionConflict(new ApiRequestError({ message: 'conflict', status: 409 }))).toBe(true);
    expect(isReadingStateRevisionConflict(new ApiRequestError({ message: 'bad request', status: 400 }))).toBe(false);
    expect(isReadingStateRevisionConflict(new Error('conflict'))).toBe(false);
  });
});
