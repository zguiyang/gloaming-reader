import { describe, expect, it } from 'vitest';

import {
  activeWordSyncKey,
  alignTimingsToStream,
  collectReadableTextNodes,
  findActiveWordTiming,
  isPunctuationOnlyTimingText,
} from '@/features/reader/audio/reader-audio-sync';

describe('reader audio sync', () => {
  const timings = [
    { text: 'Ocean', audioOffsetMs: 0, durationMs: 200, textOffset: 0 },
    { text: 'Deep', audioOffsetMs: 400, durationMs: 180, textOffset: 7 },
    { text: 'blue', audioOffsetMs: 600, durationMs: 160, textOffset: 12 },
    { text: 'sea.', audioOffsetMs: 800, durationMs: 200, textOffset: 17 },
  ];

  it('keeps the last lexical word until the next one starts', () => {
    expect(findActiveWordTiming(timings, 0)?.text).toBe('Ocean');
    expect(findActiveWordTiming(timings, 199)?.text).toBe('Ocean');
    expect(findActiveWordTiming(timings, 250)?.text).toBe('Ocean');
    expect(findActiveWordTiming(timings, 450)?.text).toBe('Deep');
    expect(findActiveWordTiming(timings, 650)?.text).toBe('blue');
    expect(findActiveWordTiming(timings, 950)?.text).toBe('sea.');
    expect(findActiveWordTiming(timings, -1)).toBeNull();
    expect(findActiveWordTiming([], 10)).toBeNull();
  });

  it('skips punctuation-only boundaries when picking the active word', () => {
    const withPunct = [
      { text: 'Hello', audioOffsetMs: 0, durationMs: 80, textOffset: 0 },
      { text: '.', audioOffsetMs: 90, durationMs: 40, textOffset: 5 },
      { text: 'World', audioOffsetMs: 200, durationMs: 80, textOffset: 7 },
    ];
    expect(isPunctuationOnlyTimingText('.')).toBe(true);
    expect(findActiveWordTiming(withPunct, 100)?.text).toBe('Hello');
    expect(findActiveWordTiming(withPunct, 210)?.text).toBe('World');
  });

  it('builds a stable sync key', () => {
    expect(activeWordSyncKey(null)).toBe('none');
    expect(activeWordSyncKey(timings[0]!)).toBe('0:0:Ocean');
  });

  it('aligns timings onto a readable stream that already dropped footnote markers', () => {
    // DOM after skipping <sup>1</sup>: "Hello world.Text. after."
    // (em keeps "world"; footnote digit dropped like htmlToPlainText)
    const stream = 'Hello world.Text. after.';
    const mapped = alignTimingsToStream(stream, [
      { text: 'Hello', audioOffsetMs: 0, durationMs: 80, textOffset: 0 },
      { text: 'world.', audioOffsetMs: 100, durationMs: 80, textOffset: 6 },
      { text: 'Text.', audioOffsetMs: 200, durationMs: 80, textOffset: 12 },
      { text: 'after.', audioOffsetMs: 300, durationMs: 80, textOffset: 18 },
    ]);
    expect(mapped.get('0:0:Hello')).toEqual({ start: 0, end: 5 });
    expect(mapped.get('6:100:world.')).toEqual({ start: 6, end: 12 });
    expect(mapped.get('12:200:Text.')).toEqual({ start: 12, end: 17 });
    expect(mapped.get('18:300:after.')).toEqual({ start: 18, end: 24 });
  });

  it('falls back to edge-stripped needle when Azure keeps glued punctuation differently', () => {
    const stream = 'Hello world';
    const mapped = alignTimingsToStream(stream, [
      { text: 'Hello', audioOffsetMs: 0, durationMs: 50, textOffset: 0 },
      { text: 'world!', audioOffsetMs: 60, durationMs: 50, textOffset: 6 },
    ]);
    expect(mapped.get('6:60:world!')).toEqual({ start: 6, end: 11 });
  });

  it('omits timings that cannot be found in order', () => {
    const stream = 'Only here';
    const mapped = alignTimingsToStream(stream, [
      { text: 'Missing', audioOffsetMs: 0, durationMs: 50, textOffset: 0 },
      { text: 'here', audioOffsetMs: 60, durationMs: 50, textOffset: 8 },
    ]);
    expect(mapped.has('0:0:Missing')).toBe(false);
    // Cursor stays at 0 after miss, so "here" can still match.
    expect(mapped.get('8:60:here')).toEqual({ start: 5, end: 9 });
  });

  it('collectReadableTextNodes filters out bilingual translation nodes and footnote tags', () => {
    const enTextNode = {
      nodeType: 3,
      data: 'English sentence.',
      parentElement: {
        tagName: 'P',
        hasAttribute: (attr: string) => attr === 'data-p',
        parentElement: null,
      },
    };
    const zhTextNode = {
      nodeType: 3,
      data: '中文句子。',
      parentElement: {
        tagName: 'DIV',
        hasAttribute: (attr: string) => attr === 'data-bilingual-translation',
        parentElement: null,
      },
    };
    const supTextNode = {
      nodeType: 3,
      data: '1',
      parentElement: {
        tagName: 'SUP',
        hasAttribute: () => false,
        parentElement: null,
      },
    };

    let idx = 0;
    const allNodes = [enTextNode, zhTextNode, supTextNode];
    const mockTreeWalker = {
      nextNode: () => {
        if (idx < allNodes.length) {
          const node = allNodes[idx];
          idx += 1;
          return node;
        }
        return null;
      },
    };

    const mockRoot = {
      ownerDocument: {
        createTreeWalker: () => mockTreeWalker,
      },
    } as unknown as ParentNode;

    const collected = collectReadableTextNodes(mockRoot);
    expect(collected.length).toBe(1);
    expect(collected[0]?.data).toBe('English sentence.');
  });
});
