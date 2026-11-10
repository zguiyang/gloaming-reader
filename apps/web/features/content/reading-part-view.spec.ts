// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BilingualTranslationData } from '@/features/content/bilingual-translation';
import { LocaleProvider } from '@/lib/locale-context';

import { ReadingPartView, transformBilingualHtml } from './reading-part-view';

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
      // Reading body is lang="en" — translations must not inherit English.
      expect(span.getAttribute('lang')).toBe('zh');
    });
  });
});

describe('ReadingPartView (reading typography contract)', () => {
  function renderReadingBody(html: string): string {
    return renderToStaticMarkup(
      // createElement typing requires children on props; third-arg children trips eslint.
      // eslint-disable-next-line react/no-children-prop -- test-only LocaleProvider wrapper
      createElement(LocaleProvider, {
        locale: 'zh-CN',
        children: createElement(ReadingPartView, { html }),
      }),
    );
  }

  it('declares lang="en" on the reading body regardless of the UI locale', () => {
    const markup = renderReadingBody('<p data-p="0">A short line.</p>');
    const match = markup.match(/<div[^>]*class="reading-body[^>]*>/);
    expect(match).not.toBeNull();
    expect(match?.[0]).toContain('lang="en"');
  });

  it('marks the reading column for hyphenation and gates justification on measure', () => {
    const globalsCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../app/globals.css'), 'utf8');

    // Hyphenation is what keeps justified English free of stretched word rivers.
    expect(globalsCss).toMatch(/\.reading-body p \{[^}]*hyphens: auto;/);
    // Justification must be container-gated (narrow column → ragged right),
    // never an unconditional text-align: justify on every reading paragraph.
    expect(globalsCss).toMatch(/@container \(min-width: 32rem\)/);
    const containerBlock = globalsCss.match(/@container \(min-width: 32rem\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(containerBlock).toContain('text-align: justify');
    const baseParagraphRule = globalsCss.match(/\.reading-body p \{[^}]*\}/)?.[0] ?? '';
    expect(baseParagraphRule).not.toContain('text-align: justify');
  });
});
