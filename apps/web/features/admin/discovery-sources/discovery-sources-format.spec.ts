import { describe, expect, it } from 'vitest';

import { formatDiscoveryElapsed } from './discovery-sources-format';

describe('formatDiscoveryElapsed', () => {
  const start = new Date('2030-01-01T00:00:00.000Z');

  it('grows with now while the run is still in progress', () => {
    const now = new Date('2030-01-01T00:01:05.000Z');
    expect(formatDiscoveryElapsed(start, 'en-US', { now })).toBe('1m 05s');
  });

  it('freezes the elapsed time at the completion time for a finished run', () => {
    const finishedAt = new Date('2030-01-01T00:02:30.000Z');
    // A much later `now` must not keep inflating a completed run's elapsed time.
    const laterNow = new Date('2030-01-01T01:00:00.000Z');
    expect(formatDiscoveryElapsed(start, 'en-US', { now: laterNow, finishedAt })).toBe('2m 30s');
  });

  it('returns zeroed elapsed for a missing start', () => {
    expect(formatDiscoveryElapsed(null, 'en-US', { now: new Date('2030-01-01T00:05:00.000Z') })).toBe('0m 00s');
  });
});
