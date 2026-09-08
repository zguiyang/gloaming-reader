'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Keep a transient "active" UI flag on for at least `minMs` from when it became true.
 * setState only runs inside timeouts (avoids sync setState-in-effect lint).
 */
export function useMinimumHold(isActive: boolean, minMs: number): boolean {
  const [isHolding, setIsHolding] = useState(false);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    let isCancelled = false;
    let endHoldTimer: number | undefined;

    if (isActive) {
      if (startedAtRef.current == null) {
        startedAtRef.current = Date.now();
      }
      return () => {
        isCancelled = true;
        if (endHoldTimer != null) {
          window.clearTimeout(endHoldTimer);
        }
      };
    }

    const startedAt = startedAtRef.current;
    startedAtRef.current = null;
    if (startedAt == null) {
      return;
    }

    const remainMs = Math.max(0, minMs - (Date.now() - startedAt));
    const startHoldTimer = window.setTimeout(() => {
      if (isCancelled) {
        return;
      }
      setIsHolding(true);
      endHoldTimer = window.setTimeout(() => {
        if (!isCancelled) {
          setIsHolding(false);
        }
      }, remainMs);
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(startHoldTimer);
      if (endHoldTimer != null) {
        window.clearTimeout(endHoldTimer);
      }
    };
  }, [isActive, minMs]);

  return isActive || isHolding;
}
