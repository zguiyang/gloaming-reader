'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { isReaderCenterTapZone } from '@/features/reader/reader-content-tap-zone';
import { useReaderChromeSuppressed } from '@/features/reader/reader-chrome-suppression';

/** Hide chrome after this long without toolbar interaction (mouse may be elsewhere). */
export const READER_CHROME_IDLE_MS = 5_000;
/** Hide shortly after pointer leaves the toolbar so font/audio controls can be clicked in place. */
export const READER_CHROME_LEAVE_HIDE_MS = 250;

export function useReaderChromeVisibility() {
  const chromeSuppressed = useReaderChromeSuppressed();
  const [visible, setVisible] = useState(false);
  const hoveredRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current !== null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearIdleTimer();
    clearLeaveTimer();
    setVisible(false);
  }, [clearIdleTimer, clearLeaveTimer]);

  const scheduleIdleHide = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      if (!hoveredRef.current) {
        setVisible(false);
      }
    }, READER_CHROME_IDLE_MS);
  }, [clearIdleTimer]);

  const show = useCallback(() => {
    if (chromeSuppressed) return;
    setVisible(true);
    scheduleIdleHide();
  }, [chromeSuppressed, scheduleIdleHide]);

  const toggleFromReaderContent = useCallback(() => {
    if (chromeSuppressed) return;
    setVisible((current) => {
      const next = !current;
      if (next) {
        scheduleIdleHide();
      } else {
        clearIdleTimer();
        clearLeaveTimer();
      }
      return next;
    });
  }, [chromeSuppressed, clearIdleTimer, clearLeaveTimer, scheduleIdleHide]);

  const onChromePointerEnter = useCallback(() => {
    hoveredRef.current = true;
    clearLeaveTimer();
    scheduleIdleHide();
  }, [clearLeaveTimer, scheduleIdleHide]);

  const onChromePointerLeave = useCallback(() => {
    hoveredRef.current = false;
    clearLeaveTimer();
    leaveTimerRef.current = setTimeout(() => {
      setVisible(false);
    }, READER_CHROME_LEAVE_HIDE_MS);
    scheduleIdleHide();
  }, [clearLeaveTimer, scheduleIdleHide]);

  const notifyChromeInteraction = useCallback(() => {
    scheduleIdleHide();
  }, [scheduleIdleHide]);

  useEffect(() => {
    if (!chromeSuppressed) return;
    clearIdleTimer();
    clearLeaveTimer();
  }, [chromeSuppressed, clearIdleTimer, clearLeaveTimer]);

  const chromeVisible = visible && !chromeSuppressed;

  useEffect(() => {
    if (!chromeVisible) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-reader-chrome]')) return;
      // Center column uses click toggle; pointerdown here would hide before click and re-show.
      if (target.closest('[data-reader-content]') && isReaderCenterTapZone(event.clientX, event.clientY)) {
        return;
      }
      hide();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [chromeVisible, hide]);

  useEffect(
    () => () => {
      clearIdleTimer();
      clearLeaveTimer();
    },
    [clearIdleTimer, clearLeaveTimer],
  );

  return {
    visible: chromeVisible,
    show,
    hide,
    toggleFromReaderContent,
    onChromePointerEnter,
    onChromePointerLeave,
    notifyChromeInteraction,
  };
}
