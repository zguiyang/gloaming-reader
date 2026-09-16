'use client';

import { useEffect, useRef } from 'react';

import {
  READING_HEARTBEAT_INTERVAL_MS,
  READING_HEARTBEAT_MAX_CREDIT_SECONDS,
  type ReadingHeartbeatBody,
  readingHeartbeatBodySchema,
} from '@gloaming/shared/reading-history';

function creditSeconds(elapsedMs: number): number {
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds <= 0) {
    return 0;
  }
  return Math.min(seconds, READING_HEARTBEAT_MAX_CREDIT_SECONDS);
}

type PendingHeartbeat = ReadingHeartbeatBody;

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `reader-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function heartbeatKey(heartbeat: PendingHeartbeat): string {
  return `${heartbeat.sessionId}:${heartbeat.sequenceNumber}`;
}

function postHeartbeat(
  heartbeat: PendingHeartbeat,
  mode: 'fetch' | 'beacon',
  onDelivered: (key: string) => void,
): void {
  const body = readingHeartbeatBodySchema.parse(heartbeat);
  const payload = JSON.stringify(body);
  const key = heartbeatKey(heartbeat);

  if (mode === 'beacon' && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const hasQueued = navigator.sendBeacon('/api/reading-heartbeat', new Blob([payload], { type: 'application/json' }));
    if (hasQueued) {
      onDelivered(key);
      return;
    }
  }

  void fetch('/api/reading-heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    credentials: 'same-origin',
    keepalive: true,
  })
    .then((response) => {
      if (response.ok) {
        onDelivered(key);
      }
    })
    .catch(() => {
      // Best-effort telemetry — do not surface to the reader.
    });
}

/**
 * Credits engaged reading time while the Reader tab is visible.
 * Interval: 30s. On hide/unload, flushes the remainder via sendBeacon/keepalive.
 */
export function useReadingHeartbeat(enabled: boolean): void {
  const lastTickAtRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const nextSequenceRef = useRef(1);
  const pendingRef = useRef<Map<string, PendingHeartbeat>>(new Map());

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') {
      return;
    }

    if (!sessionIdRef.current) {
      sessionIdRef.current = createSessionId();
    }

    const removeDelivered = (key: string) => {
      pendingRef.current.delete(key);
    };

    const dispatchPending = (mode: 'fetch' | 'beacon') => {
      for (const heartbeat of pendingRef.current.values()) {
        postHeartbeat(heartbeat, mode, removeDelivered);
      }
    };

    const flush = (mode: 'fetch' | 'beacon') => {
      const last = lastTickAtRef.current;
      if (last == null) {
        return;
      }
      const seconds = creditSeconds(Date.now() - last);
      lastTickAtRef.current = Date.now();
      if (seconds > 0) {
        const heartbeat = {
          seconds,
          sessionId: sessionIdRef.current!,
          sequenceNumber: nextSequenceRef.current,
        } satisfies PendingHeartbeat;
        nextSequenceRef.current += 1;
        pendingRef.current.set(heartbeatKey(heartbeat), heartbeat);
      }
      dispatchPending(mode);
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
