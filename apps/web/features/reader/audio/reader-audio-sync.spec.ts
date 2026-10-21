// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import {
  activeWordSyncKey,
  buildSegmentTimingRanges,
  collectReadableTextNodes,
  findActiveWordTiming,
  isPunctuationOnlyTimingText,
  normalizeParagraphStream,
} from '@/features/reader/audio/reader-audio-sync';

function timing(text: string, audioOffsetMs: number, textOffset: number) {
  return { text, audioOffsetMs, durationMs: 100, textOffset };
}

describe('reader audio sync', () => {
  const timings = [timing('Ocean', 0, 0), timing('Deep', 400, 7), timing('blue', 600, 12), timing('sea.', 800, 17)];

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
    const withPunct = [timing('Hello', 0, 0), timing('.', 90, 5), timing('World', 200, 7)];
    expect(isPunctuationOnlyTimingText('.')).toBe(true);
    expect(findActiveWordTiming(withPunct, 100)?.text).toBe('Hello');
    expect(findActiveWordTiming(withPunct, 210)?.text).toBe('World');
  });

  it('builds a stable sync key', () => {
    expect(activeWordSyncKey(null)).toBe('none');
    expect(activeWordSyncKey(timings[0]!)).toBe('0:0:Ocean');
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

describe('normalizeParagraphStream', () => {
  it('collapses whitespace runs and trims edges while mapping raw offsets', () => {
    const raw = '  Hello \n  world.  ';
    const normalized = normalizeParagraphStream(raw);
    expect(normalized.text).toBe('Hello world.');
    // 'H' at raw 2, 'o' at 6, space before 'world.' maps to the raw whitespace run.
    expect(normalized.rawIndex[0]).toBe(2);
    expect(normalized.rawIndex[4]).toBe(6);
    expect(normalized.rawIndex[5]).toBe(7);
    // The collapsed space maps into the raw whitespace run; 'w' resumes after it.
    expect(normalized.rawIndex[6]).toBe(11);
    expect(normalized.rawIndex[11]).toBe(16);
  });

  it('handles an all-whitespace stream', () => {
    expect(normalizeParagraphStream('  \n\t ').text).toBe('');
  });
});

describe('buildSegmentTimingRanges', () => {
  function render(html: string): HTMLDivElement {
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    return container;
  }

  it('scopes ranges to the segment paragraph only', () => {
    const root = render(`
      <article class="reading-body">
        <p data-p="0">Alpha beta gamma.</p>
        <p data-p="1">Delta beta gamma.</p>
      </article>
    `);
    const ranges = buildSegmentTimingRanges(root, {
      paragraphAnchor: '1',
      paragraphTextOffset: 0,
      textLength: 18,
      wordTimings: [timing('Delta', 0, 0), timing('beta', 100, 6)],
    });
    const delta = ranges.get('0:0:Delta')!;
    const beta = ranges.get('6:100:beta')!;
    expect(delta.toString()).toBe('Delta');
    expect(beta.toString()).toBe('beta');
    // Both ranges live inside the second paragraph.
    const secondParagraph = root.querySelectorAll('[data-p]')[1]!;
    expect(secondParagraph.contains(delta.commonAncestorContainer)).toBe(true);
    expect(secondParagraph.contains(beta.commonAncestorContainer)).toBe(true);
  });

  it('returns no ranges when the anchor paragraph is missing', () => {
    const root = render('<article class="reading-body"><p data-p="0">Only one.</p></article>');
    const ranges = buildSegmentTimingRanges(root, {
      paragraphAnchor: '9',
      paragraphTextOffset: 0,
      textLength: 8,
      wordTimings: [timing('Only', 0, 0)],
    });
    expect(ranges.size).toBe(0);
    expect(
      buildSegmentTimingRanges(null, {
        paragraphAnchor: '0',
        paragraphTextOffset: 0,
        textLength: 4,
        wordTimings: [timing('Only', 0, 0)],
      }).size,
    ).toBe(0);
  });

  it('matches repeated words after the manifest offset, never from the paragraph start', () => {
    // "Do or do not. There is no try. Do again."
    // Second chunk starts at offset 20 ("Do again."), so its "Do" must hit the LAST "Do".
    const root = render(`
      <article class="reading-body">
        <p data-p="0">Do or do not. There is no try. Do again.</p>
      </article>
    `);
    const paragraphText = 'Do or do not. There is no try. Do again.';
    const offset = paragraphText.indexOf('Do again.');
    const ranges = buildSegmentTimingRanges(root, {
      paragraphAnchor: '0',
      paragraphTextOffset: offset,
      textLength: 'Do again.'.length,
      wordTimings: [timing('Do', 0, 0), timing('again.', 100, 3)],
    });
    const repeated = ranges.get('0:0:Do')!;
    expect(repeated.toString()).toBe('Do');
    // It is the trailing "Do", not the first one at position 0.
    expect(repeated.startOffset).toBe(offset);
    expect(ranges.get('3:100:again.')!.toString()).toBe('again.');
  });

  it('rejects matches beyond the segment end', () => {
    // Chunk covers "alpha" only (offset 0, length 6) — "beta" must not be reached.
    const root = render(`
      <article class="reading-body">
        <p data-p="0">alpha beta.</p>
      </article>
    `);
    const ranges = buildSegmentTimingRanges(root, {
      paragraphAnchor: '0',
      paragraphTextOffset: 0,
      textLength: 6,
      wordTimings: [timing('beta', 0, 0)],
    });
    expect(ranges.size).toBe(0);
  });

  it('maps normalized offsets back onto raw HTML whitespace', () => {
    const root = document.createElement('div');
    root.className = 'reading-body';
    // Raw text nodes contain newlines + indentation that the backend normalization collapsed.
    root.innerHTML = '<p data-p="0">\n      First line second.\n    </p>';
    document.body.appendChild(root);
    const paragraphText = 'First line second.';
    const offset = paragraphText.indexOf('second.');
    const ranges = buildSegmentTimingRanges(root, {
      paragraphAnchor: '0',
      paragraphTextOffset: offset,
      textLength: 'second.'.length,
      wordTimings: [timing('second.', 0, 0)],
    });
    const range = ranges.get('0:0:second.')!;
    expect(range.toString()).toBe('second.');
    // Raw paragraph text (with indentation) still contains the word at a later offset.
    const rawText = root.querySelector('p')!.textContent!;
    expect(range.startOffset).toBe(rawText.indexOf('second.'));
  });

  it('covers words that cross element boundaries', () => {
    const root = render(`
      <article class="reading-body">
        <p data-p="0">over<em>flow</em>ing water.</p>
      </article>
    `);
    const ranges = buildSegmentTimingRanges(root, {
      paragraphAnchor: '0',
      paragraphTextOffset: 0,
      textLength: 'overflowing water.'.length,
      wordTimings: [timing('overflowing', 0, 0), timing('water.', 100, 12)],
    });
    const crossing = ranges.get('0:0:overflowing')!;
    expect(crossing.toString()).toBe('overflowing');
    expect(crossing.startContainer).not.toBe(crossing.endContainer);
    const water = ranges.get('12:100:water.')!;
    expect(water.toString()).toBe('water.');
  });

  it('falls back to the edge-stripped needle when punctuation differs', () => {
    const root = render(`
      <article class="reading-body">
        <p data-p="0">Hello world</p>
      </article>
    `);
    const ranges = buildSegmentTimingRanges(root, {
      paragraphAnchor: '0',
      paragraphTextOffset: 0,
      textLength: 11,
      wordTimings: [timing('Hello', 0, 0), timing('world!', 60, 6)],
    });
    expect(ranges.get('6:60:world!')!.toString()).toBe('world');
  });
});
