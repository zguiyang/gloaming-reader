// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import type { BilingualTranslationData } from '@/features/content/bilingual-translation';

import { transformBilingualHtml } from './reading-part-view';

describe('ReadingPartView (Bilingual sentence pair & spotlight)', () => {
  const sampleHtml = `
    <p data-p="0">It was a dark and stormy night. The wind was howling outside.</p>
    <p data-p="1">Call me Ishmael.</p>
  `;

  const bilingualData: BilingualTranslationData = {
    sentences: [
      { index: 0, paragraphIndex: 0, en: 'It was a dark and stormy night.' },
      { index: 1, paragraphIndex: 0, en: 'The wind was howling outside.' },
      { index: 2, paragraphIndex: 1, en: 'Call me Ishmael.' },
    ],
    translationsByIndex: {
      0: '那是一个漆黑而风雨交加的夜晚。',
      1: '狂风在外面呼啸。',
      2: '叫我伊斯梅尔。',
    },
    titleZh: null,
    isLoading: false,
    isStreaming: false,
  };

  it('renders standard sanitized html when bilingual mode is off', () => {
    const htmlOutput = transformBilingualHtml(sampleHtml, {
      isBilingual: false,
      bilingualData: null,
    });
    expect(htmlOutput).toContain('<p data-p="0">It was a dark and stormy night. The wind was howling outside.</p>');
  });

  it('splits multi-sentence paragraph into sentence pairs with translations', () => {
    const htmlOutput = transformBilingualHtml(sampleHtml, {
      isBilingual: true,
      bilingualData,
    });
    expect(htmlOutput).toContain('data-sentence-pair="true"');
    expect(htmlOutput).toContain('data-sentence-index="0"');
    expect(htmlOutput).toContain('data-sentence-index="1"');
    expect(htmlOutput).toContain('data-sentence-index="2"');
    expect(htmlOutput).toContain('data-bilingual-translation="true"');
    expect(htmlOutput).toContain('那是一个漆黑而风雨交加的夜晚。');
    expect(htmlOutput).toContain('狂风在外面呼啸。');
    expect(htmlOutput).toContain('叫我伊斯梅尔。');
  });

  it('applies spotlight styling to the focused sentence', () => {
    const htmlOutput = transformBilingualHtml(sampleHtml, {
      isBilingual: true,
      bilingualData,
      focusedSentenceIndex: 1,
    });
    expect(htmlOutput).toContain('ring-amber-500/20');
    // non-focused sentences have muted opacity when another sentence is focused
    expect(htmlOutput).toContain('opacity-40');
  });

  it('supports streaming incremental sentences without crashing or losing untranslated parts', () => {
    const partialData: BilingualTranslationData = {
      sentences: [
        { index: 0, paragraphIndex: 0, en: 'It was a dark and stormy night.' },
        { index: 1, paragraphIndex: 0, en: 'The wind was howling outside.' },
        { index: 2, paragraphIndex: 1, en: 'Call me Ishmael.' },
      ],
      translationsByIndex: {
        0: '那是一个漆黑而风雨交加的夜晚。',
        // 1 & 2 not yet received
      },
      titleZh: null,
      isLoading: true,
      isStreaming: true,
    };

    const htmlOutput = transformBilingualHtml(sampleHtml, {
      isBilingual: true,
      bilingualData: partialData,
    });

    expect(htmlOutput).toContain('那是一个漆黑而风雨交加的夜晚。');
    expect(htmlOutput).toContain('The wind was howling outside.');
    expect(htmlOutput).toContain('Call me Ishmael.');
    expect(htmlOutput).not.toContain('狂风在外面呼啸。');
  });

  it('keeps English text stream clean and unbroken for audio sync and selection', () => {
    const htmlOutput = transformBilingualHtml(sampleHtml, {
      isBilingual: true,
      bilingualData,
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlOutput, 'text/html');

    // All English spans should have data-sentence-index matching their sentence
    const enSpans = doc.querySelectorAll('.sentence-en');
    expect(enSpans.length).toBe(3);
    expect(enSpans[0]?.getAttribute('data-sentence-index')).toBe('0');
    expect(enSpans[1]?.getAttribute('data-sentence-index')).toBe('1');
    expect(enSpans[2]?.getAttribute('data-sentence-index')).toBe('2');

    // All translations have data-bilingual-translation="true"
    const zhSpans = doc.querySelectorAll('.sentence-zh');
    expect(zhSpans.length).toBe(3);
    zhSpans.forEach((span) => {
      expect(span.getAttribute('data-bilingual-translation')).toBe('true');
    });
  });
});
