import { describe, expect, it } from 'vitest';

import { createTranslateLineParser, parseTranslateOutputLine, splitPartSentences } from '@/domains/translate';
import { hashPartAudioContent, hashPartContent } from '@/domains/works/content';

describe('hashPartContent', () => {
  it('is stable for equivalent whitespace', () => {
    const a = hashPartContent('Hello', 'One.\n\nTwo.');
    const b = hashPartContent('Hello', 'One.\n\n\nTwo.');
    expect(a).toBe(b);
  });

  it('changes when body changes', () => {
    const a = hashPartContent('Hello', 'One.');
    const b = hashPartContent('Hello', 'Two.');
    expect(a).not.toBe(b);
  });
});

describe('hashPartAudioContent', () => {
  it('is stable for equivalent body markup whitespace', () => {
    const a = hashPartAudioContent('<p>Body text.</p>');
    const b = hashPartAudioContent('<p>Body   text.</p>');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs from title-inclusive part content hash', () => {
    expect(hashPartAudioContent('<p>One.</p>')).not.toBe(hashPartContent('Title', '<p>One.</p>'));
  });
});

describe('splitPartSentences', () => {
  it('splits paragraphs and sentences with global indices', () => {
    const sentences = splitPartSentences('Hello world. Next sentence.\n\nNew paragraph!');
    expect(sentences).toEqual([
      { index: 0, paragraphIndex: 0, en: 'Hello world.' },
      { index: 1, paragraphIndex: 0, en: 'Next sentence.' },
      { index: 2, paragraphIndex: 1, en: 'New paragraph!' },
    ]);
  });

  it('splits HTML paragraphs with data-p ordinals', () => {
    const html = '<p data-p="0">Hello world. Next sentence.</p><p data-p="1">New paragraph!</p>';
    const sentences = splitPartSentences(html);
    expect(sentences).toEqual([
      { index: 0, paragraphIndex: 0, en: 'Hello world.' },
      { index: 1, paragraphIndex: 0, en: 'Next sentence.' },
      { index: 2, paragraphIndex: 1, en: 'New paragraph!' },
    ]);
  });

  it('keeps paragraphIndex aligned with leaf data-p after nested wrappers', () => {
    const html =
      '<h1 data-p="0">Title</h1><blockquote><div><p data-p="1">On this world. Ignored man.</p></div></blockquote><p data-p="2">Trudging homeward.</p>';
    const sentences = splitPartSentences(html);
    expect(sentences.map((s) => ({ p: s.paragraphIndex, en: s.en }))).toEqual([
      { p: 0, en: 'Title' },
      { p: 1, en: 'On this world.' },
      { p: 1, en: 'Ignored man.' },
      { p: 2, en: 'Trudging homeward.' },
    ]);
  });

  it('keeps Mr. from hard-splitting', () => {
    const sentences = splitPartSentences('Mr. Smith smiled. Then he left.');
    expect(sentences).toHaveLength(2);
    expect(sentences[0]?.en).toBe('Mr. Smith smiled.');
  });
});

describe('translate line protocol', () => {
  it('parses TITLE and indexed lines', () => {
    expect(parseTranslateOutputLine('TITLE\t狐狸')).toEqual({ kind: 'title', zh: '狐狸' });
    expect(parseTranslateOutputLine('0\t第一句')).toEqual({ kind: 'sentence', index: 0, zh: '第一句' });
  });

  it('streams incomplete lines until newline', () => {
    const parser = createTranslateLineParser();
    expect(parser.push('TITLE\t你好')).toEqual([]);
    expect(parser.push('\n0\t第一')).toEqual([{ kind: 'title', zh: '你好' }]);
    expect(parser.push('句\n')).toEqual([{ kind: 'sentence', index: 0, zh: '第一句' }]);
    expect(parser.flush()).toEqual([]);
  });
});
