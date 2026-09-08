'use client';

import { useEffect, useRef } from 'react';

import {
  READING_HEARTBEAT_INTERVAL_MS,
  READING_HEARTBEAT_MAX_CREDIT_SECONDS,
  readingHeartbeatBodySchema,
} from '@gloaming/shared/reading-history';

function creditSeconds(elapsedMs: number): number {
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds <= 0) {
    return 0;
  }
  return Math.min(seconds, READING_HEARTBEAT_MAX_CREDIT_SECONDS);
}

function postHeartbeat(seconds: number, mode: 'fetch' | 'beacon'): void {
  const body = readingHeartbeatBodySchema.parse({ seconds });
  const payload = JSON.stringify(body);

  if (mode === 'beacon' && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const hasQueued = navigator.sendBeacon('/api/reading-heartbeat', new Blob([payload], { type: 'application/json' }));
    if (hasQueued) {
      return;
    }
  }

  void fetch('/api/reading-heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => {
    // Best-effort telemetry — do not surface to the reader.
  });
}

/**
 * Credits engaged reading time while the Reader tab is visible.
 * Interval: 30s. On hide/unload, flushes the remainder via sendBeacon/keepalive.
 */
export function useReadingHeartbeat(enabled: boolean): void {
  const lastTickAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') {
      return;
    }

    const flush = (mode: 'fetch' | 'beacon') => {
      const last = lastTickAtRef.current;
      if (last == null) {
        return;
      }
      const seconds = creditSeconds(Date.now() - last);
      lastTickAtRef.current = Date.now();
      if (seconds > 0) {
        postHeartbeat(seconds, mode);
      }
    };

    const start = () => {
      lastTickAtRef.current = Date.now();
    };

    const stop = (mode: 'fetch' | 'beacon') => {
      flush(mode);
      lastTickAtRef.current = null;
    };

    let intervalId: number | null = null;

    const clearTick = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const armTick = () => {
      clearTick();
      intervalId = window.setInterval(() => {
        if (document.visibilityState !== 'visible') {
          return;
        }
        flush('fetch');
      }, READING_HEARTBEAT_INTERVAL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        start();
        armTick();
        return;
      }
      clearTick();
      stop('beacon');
    };

    const onPageHide = () => {
      clearTick();
      stop('beacon');
    };

    if (document.visibilityState === 'visible') {
      start();
      armTick();
    }

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      clearTick();
      stop('beacon');
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [enabled]);
}
