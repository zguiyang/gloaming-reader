'use client';

import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import {
  ReaderAudioController,
  type ReaderAudioControllerState,
} from '@/features/reader/audio/reader-audio-controller';
import { getReaderAudioManifest, getReaderAudioSegment } from '@/features/reader/reader-api';
import {
  DEFAULT_READER_AUDIO_ROLE,
  type ReaderAudioRole,
  type ReaderPlaybackRate,
} from '@/features/reader/reader-model';
import { useLocale } from '@/lib/locale-context';

type UseReaderAudioArgs = {
  contentRef: RefObject<HTMLDivElement | null>;
  partId: string | null;
  ttsConfigured: boolean;
};

const INITIAL_STATE: ReaderAudioControllerState = {
  status: 'idle',
  role: DEFAULT_READER_AUDIO_ROLE,
  currentIndex: -1,
  segment: null,
};

/**
 * Binds the lazy reader-audio controller to the app: real API fetchers,
 * locale-aware failure toasts, teardown on part change and unmount.
 */
export function useReaderAudio({ contentRef, partId, ttsConfigured }: UseReaderAudioArgs): {
  state: ReaderAudioControllerState;
  /** Live audio element for listen-highlight sync (null before first play). */
  audioRef: RefObject<HTMLAudioElement | null>;
  toggle: () => void;
  stop: () => void;
  selectRole: (role: ReaderAudioRole) => void;
  setPlaybackRate: (rate: ReaderPlaybackRate) => void;
  /** Chapter listening progress, 0–1 — sampled periodically by the mini player. */
  getChapterProgress: () => number;
} {
  const { locale } = useLocale();
  const [state, setState] = useState<ReaderAudioControllerState>(INITIAL_STATE);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // The locale never changes at runtime without a full page reload, so
  // locale-scoped callbacks stay valid for the controller's lifetime.
  const handleUnavailable = useCallback(() => {
    toast.error(t(locale, 'content.reader.tts.unavailable'));
  }, [locale]);
  const handleSegmentFailed = useCallback(() => {
    toast.error(t(locale, 'content.reader.tts.segmentFailed'));
  }, [locale]);

  const contentRefRef = useRef(contentRef);
  useEffect(() => {
    contentRefRef.current = contentRef;
  }, [contentRef]);

  const controller = useMemo(
    () =>
      new ReaderAudioController({
        fetchManifest: getReaderAudioManifest,
        fetchSegment: getReaderAudioSegment,
        onStateChange: setState,
        onUnavailable: handleUnavailable,
        onSegmentFailed: handleSegmentFailed,
      }),
    [handleUnavailable, handleSegmentFailed],
  );

  // Keep the highlight sync ref pointing at the controller's live audio element.
  // Declared before useReaderListenHighlight in the page so its paint effects
  // observe a fresh ref.
  useLayoutEffect(() => {
    audioRef.current = controller.getAudioElement();
  });

  useEffect(() => {
    controller.setContext({ partId, ttsConfigured });
  }, [controller, partId, ttsConfigured]);

  useEffect(() => {
    return () => controller.destroy();
  }, [controller]);

  const toggle = useCallback(() => controller.toggle(contentRefRef.current?.current ?? null), [controller]);
  const stop = useCallback(() => controller.stop(), [controller]);
  const selectRole = useCallback((role: ReaderAudioRole) => controller.selectRole(role), [controller]);
  const setPlaybackRate = useCallback((rate: ReaderPlaybackRate) => controller.setPlaybackRate(rate), [controller]);
  const getChapterProgress = useCallback(() => controller.getChapterProgress(), [controller]);

  return { state, audioRef, toggle, stop, selectRole, setPlaybackRate, getChapterProgress };
}
