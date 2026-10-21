import { describe, expect, it } from 'vitest';

import { normalizeTtsInput } from '@gloaming/shared/tts';

import { deriveReaderAudioSegments, SEGMENT_MAX_CHARS } from '@/domains/reader-audio/segmenter';

function paragraph(text: string, ordinal = 0): string {
  return `<p data-p="${ordinal}">${text}</p>`;
}

describe('deriveReaderAudioSegments', () => {
  it('returns no segments for an empty body', () => {
    expect(deriveReaderAudioSegments('')).toEqual([]);
    expect(deriveReaderAudioSegments('   \n  ')).toEqual([]);
  });

  it('returns no segments when no leaf paragraph carries data-p', () => {
    expect(deriveReaderAudioSegments('<span>Loose text without blocks.</span>')).toEqual([]);
  });

  it('reindexes paragraphs and emits segments in document order with anchors', () => {
    const body = [
      '<section><p data-p="7">First sentence here.</p>',
      '<p data-p="7">Second paragraph follows.</p></section>',
    ].join('');
    const segments = deriveReaderAudioSegments(body);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ index: 0, key: 'p0:c0', paragraphAnchor: '0', paragraphTextOffset: 0 });
    expect(segments[0]!.text).toBe('First sentence here.');
    expect(segments[1]).toMatchObject({ index: 1, key: 'p1:c0', paragraphAnchor: '1', paragraphTextOffset: 0 });
    expect(segments[1]!.text).toBe('Second paragraph follows.');
  });

  it('splits an over-long paragraph at sentence boundaries under the character budget with offsets', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog near the riverbank at dawn.';
    const paragraphText = Array.from({ length: 12 }, () => sentence).join(' ');
    expect(paragraphText.length).toBeGreaterThan(SEGMENT_MAX_CHARS);

    const segments = deriveReaderAudioSegments(paragraph(paragraphText));
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.textLength).toBeLessThanOrEqual(SEGMENT_MAX_CHARS);
      expect(segment.paragraphTextOffset).toBeGreaterThanOrEqual(0);
      // Chunk offsets land exactly on the chunk text inside the paragraph.
      expect(paragraphText.slice(segment.paragraphTextOffset, segment.paragraphTextOffset + segment.textLength)).toBe(
        segment.text,
      );
    }
    // Offsets strictly increase and cover the paragraph in order.
    const offsets = segments.map((s) => s.paragraphTextOffset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    // Keys keep the per-paragraph chunk ordinal.
    expect(segments.map((s) => s.key)).toEqual(segments.map((_, i) => `p0:c${i}`));
  });

  it('still chunks a single over-long sentenceless run by length', () => {
    const longRun = 'a'.repeat(SEGMENT_MAX_CHARS * 2 + 10);
    const segments = deriveReaderAudioSegments(paragraph(longRun));
    expect(segments.length).toBe(3);
    expect(segments.map((s) => s.textLength)).toEqual([SEGMENT_MAX_CHARS, SEGMENT_MAX_CHARS, 10]);
    expect(segments.map((s) => s.paragraphTextOffset)).toEqual([0, SEGMENT_MAX_CHARS, SEGMENT_MAX_CHARS * 2]);
  });

  it('excludes sup/sub and bilingual translation injections from synth text', () => {
    const body =
      '<p data-p="0">Visible words<sup>12</sup> stay<sub>2</sub> here.' +
      '<span data-bilingual-translation>不可见译文</span></p>';
    const [segment] = deriveReaderAudioSegments(body);
    expect(segment).toBeDefined();
    expect(segment!.text).toBe('Visible words stay here.');
    expect(segment!.text).not.toContain('12');
    expect(segment!.text).not.toContain('不可见译文');
  });

  it('skips empty and pure-punctuation chunks without consuming indexes', () => {
    const body = `${paragraph('---', 0)}${paragraph('Real text remains.', 1)}`;
    const segments = deriveReaderAudioSegments(body);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ index: 0, paragraphAnchor: '1', text: 'Real text remains.' });
  });

  it('produces stable hashes derived from synth text', () => {
    const body = `${paragraph('A stable  sentence.', 0)}${paragraph('Another one.', 1)}`;
    const first = deriveReaderAudioSegments(body);
    const second = deriveReaderAudioSegments(body);
    expect(first.map((s) => s.segmentHash)).toEqual(second.map((s) => s.segmentHash));
    expect(first[0]!.synthText).toBe(normalizeTtsInput('A stable sentence.').ttsText);
    expect(first[0]!.segmentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
