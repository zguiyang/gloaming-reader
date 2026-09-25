import { describe, expect, it } from 'vitest';

import { filterPersistedWordTimings } from './persisted-word-timings.ts';

describe('filterPersistedWordTimings', () => {
  const valid = {
    text: 'Hello',
    audioOffsetMs: 0,
    durationMs: 120,
    textOffset: 0,
  };

  it('keeps valid entries and rounds fractional milliseconds', () => {
    expect(
      filterPersistedWordTimings([valid, { text: 'world', audioOffsetMs: 120.4, durationMs: 80.6, textOffset: 6 }]),
    ).toEqual([valid, { text: 'world', audioOffsetMs: 120, durationMs: 81, textOffset: 6 }]);
  });

  it('drops textOffset -1, negative, non-integer, and non-finite fields', () => {
    expect(
      filterPersistedWordTimings([
        valid,
        { ...valid, textOffset: -1 },
        { ...valid, textOffset: 1.5 },
        { ...valid, audioOffsetMs: Number.NaN },
        { ...valid, durationMs: -1 },
      ]),
    ).toEqual([valid]);
  });

  it('drops corrupt provider timing text', () => {
    expect(filterPersistedWordTimings([valid, { ...valid, text: 'amp;' }])).toEqual([valid]);
  });
});
