import { describe, expect, it } from 'vitest';

import { validateAzureWordTimings } from './azure-word-timing-validation.ts';
import { normalizeTtsInput } from './tts-input-normalization.ts';

describe('validateAzureWordTimings', () => {
  const sample = normalizeTtsInput('hello world');

  it('accepts valid boundaries and maps text offsets to source space', () => {
    const timings = validateAzureWordTimings([{ text: 'hello', audioOffsetMs: 0, durationMs: 100, textOffset: 0 }], {
      ttsTextLength: sample.ttsText.length,
      mapTtsOffsetToSource: sample.mapTtsOffsetToSource,
    });
    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({ textOffset: 0, audioOffsetMs: 0, durationMs: 100 });
  });

  it('rejects textOffset -1 and out-of-range offsets', () => {
    expect(
      validateAzureWordTimings([{ text: 'x', audioOffsetMs: 0, durationMs: 10, textOffset: -1 }], {
        ttsTextLength: 5,
        mapTtsOffsetToSource: (n) => n,
      }),
    ).toEqual([]);
    expect(
      validateAzureWordTimings([{ text: 'x', audioOffsetMs: 0, durationMs: 10, textOffset: 99 }], {
        ttsTextLength: 5,
        mapTtsOffsetToSource: (n) => n,
      }),
    ).toEqual([]);
  });

  it('rejects non-finite or negative audio fields and backward audio offsets', () => {
    expect(
      validateAzureWordTimings([{ text: 'a', audioOffsetMs: Number.NaN, durationMs: 10, textOffset: 0 }], {
        ttsTextLength: 5,
        mapTtsOffsetToSource: (n) => n,
      }),
    ).toEqual([]);
    expect(
      validateAzureWordTimings(
        [
          { text: 'a', audioOffsetMs: 100, durationMs: 10, textOffset: 0 },
          { text: 'b', audioOffsetMs: 50, durationMs: 10, textOffset: 1 },
        ],
        { ttsTextLength: 5, mapTtsOffsetToSource: (n) => n },
      ),
    ).toEqual([]);
    expect(
      validateAzureWordTimings([{ text: 'a', audioOffsetMs: 0, durationMs: -1, textOffset: 0 }], {
        ttsTextLength: 5,
        mapTtsOffsetToSource: (n) => n,
      }),
    ).toEqual([]);
  });

  it('rejects corrupt provider timing text (amp;/lt;/gt;)', () => {
    expect(
      validateAzureWordTimings([{ text: 'amp;', audioOffsetMs: 0, durationMs: 10, textOffset: 0 }], {
        ttsTextLength: 10,
        mapTtsOffsetToSource: (n) => n,
      }),
    ).toEqual([]);
    expect(
      validateAzureWordTimings([{ text: 'lt;', audioOffsetMs: 0, durationMs: 10, textOffset: 0 }], {
        ttsTextLength: 10,
        mapTtsOffsetToSource: (n) => n,
      }),
    ).toEqual([]);
  });

  it('maps offsets through risk-symbol normalization', () => {
    const normalized = normalizeTtsInput('a&b');
    const timings = validateAzureWordTimings(
      [{ text: 'and', audioOffsetMs: 0, durationMs: 50, textOffset: normalized.ttsText.indexOf('and') }],
      {
        ttsTextLength: normalized.ttsText.length,
        mapTtsOffsetToSource: normalized.mapTtsOffsetToSource,
      },
    );
    expect(timings[0]?.textOffset).toBe(1);
  });
});
