/** Bump when first-visit hint semantics change so prior false "seen" flags reset. */
export const READER_CHROME_HINT_STORAGE_KEY = 'gloaming.reader.chromeHint.v2';

const SEEN_VALUE = '1';

const listeners = new Set<() => void>();

function emitChromeHintChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeReaderChromeHint(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** Client snapshot: show hint until the user has dismissed it once in this browser. */
export function getReaderChromeHintEligible(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return localStorage.getItem(READER_CHROME_HINT_STORAGE_KEY) !== SEEN_VALUE;
  } catch {
    return false;
  }
}

/** SSR / hydration: never show until the client store is read. */
export function getReaderChromeHintServerSnapshot(): boolean {
  return false;
}

export function hasSeenReaderChromeHint(): boolean {
  return !getReaderChromeHintEligible();
}

export function markReaderChromeHintSeen(): void {
  try {
    localStorage.setItem(READER_CHROME_HINT_STORAGE_KEY, SEEN_VALUE);
  } catch {
    // localStorage may throw in private mode.
  }
  emitChromeHintChange();
}
