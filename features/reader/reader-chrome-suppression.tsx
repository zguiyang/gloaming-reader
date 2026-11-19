'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type ReaderChromeSuppressionContextValue = {
  acquire: () => () => void;
  suppressed: boolean;
};

const ReaderChromeSuppressionContext = createContext<ReaderChromeSuppressionContextValue | null>(null);

/**
 * Shared top chrome hides while any reader overlay registers suppression.
 * New side sheets / fixed panels: call `useSuppressReaderChrome(open)` next to that UI —
 * do not extend a central OR list on `reader-page`.
 */
export function ReaderChromeSuppressionProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);

  const acquire = useCallback(() => {
    setCount((current) => current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setCount((current) => Math.max(0, current - 1));
    };
  }, []);

  const value = useMemo(
    () => ({
      acquire,
      suppressed: count > 0,
    }),
    [acquire, count],
  );

  return <ReaderChromeSuppressionContext.Provider value={value}>{children}</ReaderChromeSuppressionContext.Provider>;
}

function useReaderChromeSuppressionContext(): ReaderChromeSuppressionContextValue {
  const value = useContext(ReaderChromeSuppressionContext);
  if (!value) {
    throw new Error('useReaderChromeSuppression requires ReaderChromeSuppressionProvider');
  }
  return value;
}

export function useReaderChromeSuppressed(): boolean {
  return useReaderChromeSuppressionContext().suppressed;
}

export function useSuppressReaderChrome(active: boolean): void {
  const { acquire } = useReaderChromeSuppressionContext();

  useEffect(() => {
    if (!active) return;
    return acquire();
  }, [active, acquire]);
}
