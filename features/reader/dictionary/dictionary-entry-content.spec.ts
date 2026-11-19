import { describe, expect, it } from 'vitest';

import type { DictionaryEntry } from '@/shared/dictionary';

import { entryHasUsefulDefinitions } from '@/features/reader/dictionary/dictionary-entry-content';

function entry(meanings: DictionaryEntry['meanings']): DictionaryEntry {
  return {
    word: 'Test',
    phonetics: [],
    meanings,
  };
}

describe('entryHasUsefulDefinitions', () => {
  it('rejects echo-only gloss for proper nouns', () => {
    const result = entryHasUsefulDefinitions(
      entry([{ partOfSpeech: 'general', definitions: [{ definition: 'Alice' }] }]),
      'Alice',
    );
    expect(result).toBe(false);
  });

  it('accepts Chinese or distinct English glosses', () => {
    expect(
      entryHasUsefulDefinitions(
        entry([{ partOfSpeech: 'noun', definitions: [{ definition: 'river', definitionZh: '河流' }] }]),
        'river',
      ),
    ).toBe(true);
    expect(
      entryHasUsefulDefinitions(
        entry([{ partOfSpeech: 'noun', definitions: [{ definition: 'a large stream of water' }] }]),
        'river',
      ),
    ).toBe(true);
  });
});
