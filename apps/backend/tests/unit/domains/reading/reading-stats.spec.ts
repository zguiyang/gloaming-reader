import { describe, expect, it } from 'vitest';

import {
  analyzePlainText,
  computePartReadingStats,
  computeWorkReadingStats,
  countRunningWords,
  resetReadingStatsCacheForTests,
  suggestedVocabSizeFromTokens,
} from '@/domains/reading/stats';

describe('reading-stats', () => {
  it('counts running words without inflating on repetition', () => {
    expect(countRunningWords('<p>hello hello world</p>')).toBe(3);
  });

  it('computes part word count and minutes', () => {
    const stats = computePartReadingStats('<p>' + 'word '.repeat(200) + '</p>');
    expect(stats.wordCount).toBe(200);
    expect(stats.estimatedMinutes).toBe(1);
  });

  it('lemmatizes inflected forms to one vocabulary unit', () => {
    resetReadingStatsCacheForTests();
    const tokens = analyzePlainText('walk walks walked walking');
    const vocab = suggestedVocabSizeFromTokens(tokens);
    expect(tokens.length).toBe(4);
    expect(vocab).not.toBeNull();
  });

  it('excludes proper nouns from vocabulary threshold tokens', () => {
    resetReadingStatsCacheForTests();
    const withName = analyzePlainText('John walked to the store');
    const withoutName = analyzePlainText('he walked to the store');
    expect(withName.length).toBeLessThan(withoutName.length);
  });

  it('returns null english vocab stats for non-english language', () => {
    const stats = computeWorkReadingStats([{ body: '<p>hello world</p>' }], 'zh');
    expect(stats.wordCount).toBe(2);
    expect(stats.suggestedVocabSize).toBeNull();
    expect(stats.difficultyScore).toBeNull();
  });

  it('computes english work stats after parse-sized sample', () => {
    resetReadingStatsCacheForTests();
    const body = '<p>' + 'The quick brown fox jumps over the lazy dog. '.repeat(20) + '</p>';
    const stats = computeWorkReadingStats([{ body }], 'en');
    expect(stats.wordCount).toBeGreaterThan(100);
    expect(stats.estimatedMinutes).toBeGreaterThan(0);
    expect(stats.suggestedVocabSize).toBeGreaterThan(0);
    expect(stats.difficultyScore).toBeGreaterThanOrEqual(1);
    expect(stats.difficultyScore).toBeLessThanOrEqual(5);
  });
});
