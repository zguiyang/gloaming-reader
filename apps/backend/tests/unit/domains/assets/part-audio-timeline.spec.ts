import { describe, expect, it } from 'vitest';

import { estimateSegmentDurationMs, offsetWordTimingsForChapterSegment } from '@/domains/assets/audio/part-audio-run';

describe('part audio timeline helpers', () => {
  it('uses audio byte estimate when word timings are empty', () => {
    const duration = estimateSegmentDurationMs([], 3200);
    expect(duration).toBeGreaterThan(0);
    expect(offsetWordTimingsForChapterSegment([], 1000, 5)).toEqual([]);
  });

  it('offsets valid word timings and drops invalid rows', () => {
    const duration = estimateSegmentDurationMs(
      [{ text: 'Hi', audioOffsetMs: 0, durationMs: 100, textOffset: 0 }],
      1000,
    );
    expect(duration).toBe(100);

    expect(
      offsetWordTimingsForChapterSegment(
        [
          { text: 'Hi', audioOffsetMs: 0, durationMs: 100, textOffset: 0 },
          { text: 'x', audioOffsetMs: 100, durationMs: 10, textOffset: -1 },
        ],
        50,
        3,
      ),
    ).toEqual([{ text: 'Hi', audioOffsetMs: 50, durationMs: 100, textOffset: 3 }]);
  });
});
