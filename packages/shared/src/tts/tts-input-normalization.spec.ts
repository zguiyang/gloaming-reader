import { describe, expect, it } from 'vitest';

import { AZURE_TTS_RISK_SYMBOL_RULES } from './azure-risk-symbol-rules.ts';
import { normalizeTtsInput } from './tts-input-normalization.ts';

describe('normalizeTtsInput', () => {
  it('collapses Unicode whitespace and preserves punctuation', () => {
    const { sourceText, ttsText, mapTtsOffsetToSource } = normalizeTtsInput('  Hello,\u00a0world!  ');
    expect(sourceText).toBe('Hello, world!');
    expect(ttsText).toBe(sourceText);
    expect(mapTtsOffsetToSource(0)).toBe(0);
    expect(mapTtsOffsetToSource(sourceText.length)).toBe(sourceText.length);
  });

  it('decodes residual HTML entities in a single pass when present', () => {
    const { sourceText, ttsText } = normalizeTtsInput('Tom &amp; Jerry');
    expect(sourceText).toBe('Tom & Jerry');
    expect(ttsText).toBe('Tom  and  Jerry');
  });

  it('decodes numeric residual entities via entities library', () => {
    const { sourceText } = normalizeTtsInput('it&#39;s');
    expect(sourceText).toBe("it's");
  });

  it('does not double-decode already plain ampersand text', () => {
    const once = normalizeTtsInput('A & B');
    const plain = normalizeTtsInput('A & B');
    expect(once.sourceText).toBe('A & B');
    expect(plain.ttsText).toBe(once.ttsText);
  });

  it('applies Azure risk symbol rules from the constant table', () => {
    expect(AZURE_TTS_RISK_SYMBOL_RULES.map((r) => r.source)).toEqual(['&', '<', '>']);
    const { sourceText, ttsText } = normalizeTtsInput('a<b&c>d');
    expect(sourceText).toBe('a<b&c>d');
    expect(ttsText).toBe('a less than b and c greater than d');
  });

  it('maps TTS offsets back to source offsets across expansions', () => {
    const { sourceText, ttsText, mapTtsOffsetToSource } = normalizeTtsInput('x&y');
    expect(sourceText).toBe('x&y');
    const ampIndex = ttsText.indexOf(' and ');
    expect(ampIndex).toBeGreaterThan(0);
    expect(mapTtsOffsetToSource(ampIndex)).toBe(1);
    expect(mapTtsOffsetToSource(ampIndex + 2)).toBe(1);
    expect(mapTtsOffsetToSource(ttsText.length)).toBe(sourceText.length);
  });

  it('keeps NFKC ligatures in sourceText while expanding them in ttsText', () => {
    const ligature = '\uFB03';
    const { sourceText, ttsText, mapTtsOffsetToSource } = normalizeTtsInput(`A${ligature} B`);
    expect(sourceText).toBe(`A${ligature} B`);
    expect(ttsText).toContain('ffi');
    expect(ttsText).not.toContain(ligature);
    const bIndexInSource = sourceText.indexOf('B');
    const bIndexInTts = ttsText.indexOf('B');
    expect(bIndexInSource).toBeGreaterThan(0);
    expect(bIndexInTts).toBeGreaterThan(bIndexInSource);
    expect(mapTtsOffsetToSource(bIndexInTts)).toBe(bIndexInSource);
  });

  it('applies NFKC only in ttsText for fullwidth characters', () => {
    const { sourceText, ttsText } = normalizeTtsInput('ＡＢ');
    expect(sourceText).toBe('ＡＢ');
    expect(ttsText).toBe('AB');
  });

  it('keeps zero-width and control characters in sourceText but omits them from ttsText', () => {
    const { sourceText, ttsText, mapTtsOffsetToSource } = normalizeTtsInput('a\u200bb\u0001c');
    expect(sourceText).toBe('a\u200bb\u0001c');
    expect(ttsText).toBe('abc');
    const cIndexInSource = sourceText.indexOf('c');
    const cIndexInTts = ttsText.indexOf('c');
    expect(mapTtsOffsetToSource(cIndexInTts)).toBe(cIndexInSource);
    expect(mapTtsOffsetToSource(ttsText.length)).toBe(sourceText.length);
  });

  it('keeps ordinary punctuation through whitespace normalization', () => {
    const { sourceText } = normalizeTtsInput('  Hi—there?  ');
    expect(sourceText).toBe('Hi—there?');
  });
});
