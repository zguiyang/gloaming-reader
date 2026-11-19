import type { DictionaryEntry } from '@/shared/dictionary';

/** True when at least one gloss is more than an echo of the lookup form (e.g. proper nouns). */
export function entryHasUsefulDefinitions(entry: DictionaryEntry, lookupWord: string): boolean {
  const normalizedWord = lookupWord.trim().toLowerCase();
  if (entry.meanings.length === 0) {
    return false;
  }

  for (const meaning of entry.meanings) {
    for (const def of meaning.definitions) {
      if (def.definitionZh?.trim()) {
        return true;
      }
      if (def.example?.trim() || def.exampleZh?.trim()) {
        return true;
      }
      const en = def.definition?.trim() ?? '';
      if (en && en.toLowerCase() !== normalizedWord) {
        return true;
      }
    }
  }

  return false;
}
