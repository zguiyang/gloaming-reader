'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import type { TtsWordTiming } from '@gloaming/shared/tts';

import { useAuthDialog } from '@/features/auth';
import { ReaderAiDrawer } from '@/features/reader/assist/reader-ai-drawer';
import { ReaderAiInline } from '@/features/reader/assist/reader-ai-inline';
import { useReaderAssist } from '@/features/reader/assist/use-reader-assist';
import { useReaderListenHighlight } from '@/features/reader/audio/reader-audio-highlight';
import { ReaderTts } from '@/features/reader/audio/reader-tts';
import { useDictionaryLookupQuery } from '@/features/reader/dictionary/reader-dictionary-api';
import { ReaderDictionaryView } from '@/features/reader/dictionary/reader-dictionary-view';
import {
  formatReaderApiError,
  getReaderAudioTrack,
  getReaderBootstrapCommand,
  resolvePartId,
  toReaderViewModel,
  useReaderPartQuery,
  useReaderPartsQuery,
  useReaderStateMutation,
  useReadingStateQuery,
} from '@/features/reader/reader-api';
import { ReaderChapterNav } from '@/features/reader/reader-chapter-nav';
import { ReaderChrome } from '@/features/reader/reader-chrome';
import { useReadingHeartbeat } from '@/features/reader/reader-heartbeat';
import type {
  ReaderAnchorRestore,
  ReaderAudioRole,
  ReaderAudioStatus,
  ReaderFontSize,
  ReaderPlaybackRate,
  ReaderSelection,
  ReaderSelectionRect,
  ReaderViewModel,
} from '@/features/reader/reader-model';
import {
  adjacentPart,
  DEFAULT_READER_PLAYBACK_RATE,
  formatDictionaryWordDeepDivePrompt,
  isAnchorRestorePending,
  isReaderScrollIntentKey,
  nextPlaybackRate,
  partIndex,
  planAnchorRestoreApply,
  READER_ANCHOR_RESTORE_SETTLE_MS,
  READER_ANCHOR_THROTTLE_MS,
  releaseAnchorRestoreMarkers,
  resolveAnchorFlushRatio,
  resolveAnchorRatio,
  resolveAudioRole,
  scrollPositionRatio,
  shouldPersistAnchor,
  startAnchorRestore,
} from '@/features/reader/reader-model';
import { ReaderPart, ReaderPartSkeleton } from '@/features/reader/reader-part';
import { ReaderSelectionToolbar } from '@/features/reader/reader-selection-toolbar';
import { ReaderTocSidebar } from '@/features/reader/reader-toc-sidebar';
import { ReaderUnavailable } from '@/features/reader/reader-unavailable';
import { useReaderTranslate } from '@/features/reader/translate/use-reader-translate';
import { isReadingStateRevisionConflict, saveReadingAnchor } from '@/features/reading-state/reading-state-api';
import { authClient } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';

type ReaderPageProps = {
  workId: string;
};

const FONT_CYCLE: ReaderFontSize[] = ['sm', 'md', 'lg'];

/** Keydown targets that own scroll/activation keys instead of the reading column. */
function isInteractiveScrollTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return (
    target.closest(
      'button, a[href], input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"]',
    ) !== null
  );
}

export function ReaderPage({ workId }: ReaderPageProps) {
  const { locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preferredPartId = searchParams.get('part')?.trim() || null;
  const { openLogin } = useAuthDialog();
  const { data: authData } = authClient.useSession();
  const isAuthenticated = Boolean(authData?.user);

  const partsQuery = useReaderPartsQuery(workId);
  const stateQuery = useReadingStateQuery(workId);
  const { refetch: refetchState } = stateQuery;
  const stateMutation = useReaderStateMutation(workId);

  const [activePartId, setActivePartId] = useState<string | null>(null);
  const partQuery = useReaderPartQuery(activePartId);
  const [localProgressRatio, setLocalProgressRatio] = useState<number | null>(null);
  const bootstrapStartedRef = useRef(false);

  useReadingHeartbeat(isAuthenticated && Boolean(activePartId));

  const [isChromeVisible, setIsChromeVisible] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [fontSize, setFontSize] = useState<ReaderFontSize>('md');
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [dictionaryState, setDictionaryState] = useState<{
    word: string;
    contextSentence?: string;
    rect?: ReaderSelectionRect;
    top: number;
    left: number;
  } | null>(null);
  const [audioStatus, setAudioStatus] = useState<ReaderAudioStatus>('idle');
  const [playbackRate, setPlaybackRate] = useState<ReaderPlaybackRate>(DEFAULT_READER_PLAYBACK_RATE);
  const [preferredAudioRole, setPreferredAudioRole] = useState<ReaderAudioRole | null>(null);
  const [wordTimings, setWordTimings] = useState<TtsWordTiming[] | null>(null);
  const [listeningSentenceIndex, setListeningSentenceIndex] = useState<number | null>(null);
  const [selectedSentenceIndex, setSelectedSentenceIndex] = useState<number | null>(null);
  const [tappedSentenceIndex, setTappedSentenceIndex] = useState<number | null>(null);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const restoredPartRef = useRef<string | null>(null);
  const anchorRestoreRef = useRef<ReaderAnchorRestore | null>(null);
  const anchorSaveRef = useRef<{
    lastSavedRatio: number | null;
    lastSavedAt: number;
    pendingRatio: number | null;
    lastFlushedRatio: number | null;
    timer: ReturnType<typeof setTimeout> | null;
  }>({
    lastSavedRatio: null,
    lastSavedAt: 0,
    pendingRatio: null,
    lastFlushedRatio: null,
    timer: null,
  });
  const activePartIdRef = useRef<string | null>(null);

  const partsData = partsQuery.data;
  const stateData = stateQuery.data ?? null;
  const savedAnchor = stateData?.anchor ?? null;
  const loadedPartId = partQuery.data?.part.id ?? null;

  // Read the latest anchor inside the restore effect without re-running it (and
  // tearing down an in-flight restore) when the anchor object identity changes.
  const savedAnchorRef = useRef(savedAnchor);
  useEffect(() => {
    savedAnchorRef.current = savedAnchor;
  }, [savedAnchor]);

  const assist = useReaderAssist({
    workId,
    partId: activePartId,
    isAuthenticated,
    openLogin,
  });

  const translate = useReaderTranslate({
    partId: activePartId,
    isAuthenticated,
    openLogin,
  });

  const dictionaryQuery = useDictionaryLookupQuery({
    word: dictionaryState?.word ?? null,
    contextSentence: dictionaryState?.contextSentence,
    workId,
    partId: activePartId ?? undefined,
    enabled: Boolean(dictionaryState?.word),
  });

  const reader: ReaderViewModel | null =
    partsData && partQuery.data ? toReaderViewModel(partsData, partQuery.data, stateQuery.data ?? null) : null;

  const { clearListenHighlight } = useReaderListenHighlight({
    contentRef,
    partId: reader?.partId ?? null,
    html: reader?.html ?? null,
    wordTimings,
    audioStatus,
    selectionActive: Boolean(selection),
    audioRef,
    onActiveSentenceChange: setListeningSentenceIndex,
  });

  useEffect(() => {
    if (!partsData || bootstrapStartedRef.current) return;
    if (isAuthenticated) {
      // Wait for a settled reading-state result. Real fetch/schema/auth errors
      // must not be treated as "no state" and must not trigger first-open.
      if (stateQuery.isPending) return;
      if (stateQuery.isError) return;
    }

    bootstrapStartedRef.current = true;
    const partId = resolvePartId(partsData.parts, stateData, preferredPartId);

    void (async () => {
      if (!isAuthenticated) {
        setActivePartId(partId);
        return;
      }
      try {
        const opened = await stateMutation.mutateAsync(
          getReaderBootstrapCommand({
            stateStatus: stateData?.status ?? null,
            resolvedPartId: partId,
            preferredPartId,
          }),
        );
        setLocalProgressRatio(opened.progressRatio);
        setActivePartId(opened.currentPartId ?? partId);
      } catch (error) {
        if (isReadingStateRevisionConflict(error)) {
          const refreshed = await refetchState();
          const recovered = refreshed.data;
          setLocalProgressRatio(recovered?.progressRatio ?? null);
          setActivePartId(recovered?.currentPartId ?? partId);
          return;
        }
        toast.error(formatReaderApiError(error));
        setActivePartId(partId);
      }
    })();
  }, [
    partsData,
    stateData,
    stateQuery.isPending,
    stateQuery.isError,
    isAuthenticated,
    preferredPartId,
    refetchState,
    stateMutation,
  ]);

  const persistAnchor = useCallback(
    (ratio: number) => {
      if (!isAuthenticated || !activePartId) return;
      void saveReadingAnchor(workId, { partId: activePartId, ratio }).catch(() => {
        // Background position save — never surface failure to the reader.
      });
    },
    [activePartId, isAuthenticated, workId],
  );
  const persistAnchorRef = useRef(persistAnchor);
  useEffect(() => {
    persistAnchorRef.current = persistAnchor;
  }, [persistAnchor]);

  // A saved position belongs to exactly one part; reset throttle state and any
  // in-flight restore when the open chapter changes.
  useEffect(() => {
    activePartIdRef.current = activePartId;
    anchorRestoreRef.current = null;
    restoredPartRef.current = null;
    const saveState = anchorSaveRef.current;
    saveState.lastSavedRatio = null;
    saveState.pendingRatio = null;
    saveState.lastFlushedRatio = null;
    if (saveState.timer != null) {
      clearTimeout(saveState.timer);
      saveState.timer = null;
    }
  }, [activePartId]);

  // Restore the saved within-chapter position. A resolved part query only means
  // the content node exists; images, webfonts, and translation inserts keep
  // changing its height afterwards. The restore therefore owns the scroll
  // position for a bounded settle window, re-applying the ratio whenever the
  // scrollable range changes, and yields immediately to reader scroll intent.
  useEffect(() => {
    if (!activePartId || loadedPartId !== activePartId) return;
    if (restoredPartRef.current === activePartId) return;

    const contentEl = contentRef.current;
    if (!contentEl) return;
    const container: HTMLDivElement = contentEl;

    const ratio = resolveAnchorRatio(savedAnchorRef.current, activePartId);
    restoredPartRef.current = activePartId;

    // No saved (or top) anchor: a new part starts at the top.
    if (ratio == null || ratio <= 0) {
      container.scrollTop = 0;
      return;
    }

    const partId = activePartId;
    const started = startAnchorRestore({ partId, ratio });
    if (!started) return;

    anchorRestoreRef.current = started;
    const saveState = anchorSaveRef.current;
    saveState.lastSavedRatio = ratio;

    let current = started;
    let isTornDown = false;
    let isFontsCancelled = false;

    function teardown() {
      if (isTornDown) return;
      isTornDown = true;
      isFontsCancelled = true;
      observer?.disconnect();
      container.removeEventListener('load', onContentLoad, true);
      container.removeEventListener('wheel', onUserIntent);
      container.removeEventListener('touchmove', onUserIntent);
      container.removeEventListener('keydown', onKeyIntent);
      clearTimeout(settleTimer);
    }

    function runApply(hasUserScrolled: boolean) {
      // Ignore queued work once this part is no longer the open chapter.
      if (activePartIdRef.current !== partId) return;
      const plan = planAnchorRestoreApply({
        restore: current,
        now: Date.now(),
        hasUserScrolled,
        metrics: { scrollHeight: container.scrollHeight, clientHeight: container.clientHeight },
      });
      current = plan.restore;
      anchorRestoreRef.current = current;
      if (plan.applyTop != null) {
        container.scrollTop = plan.applyTop;
      }
      if (current.status !== 'restoring') teardown();
    }

    function onContentLoad() {
      runApply(false);
    }

    function onUserIntent() {
      runApply(true);
    }

    // Only actual scroll keys cancel; a click, selection, typing key, or a key
    // owned by a focused control (e.g. Space activating a button) does not.
    function onKeyIntent(event: KeyboardEvent) {
      if (
        isReaderScrollIntentKey({
          key: event.key,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          isInteractiveTarget: isInteractiveScrollTarget(event.target),
        })
      ) {
        runApply(true);
      }
    }

    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => runApply(false));
    if (observer) {
      const content = container.firstElementChild;
      if (content) observer.observe(content);
      observer.observe(container);
    }

    container.addEventListener('load', onContentLoad, true);
    container.addEventListener('wheel', onUserIntent, { passive: true });
    container.addEventListener('touchmove', onUserIntent, { passive: true });
    container.addEventListener('keydown', onKeyIntent);

    const settleTimer = setTimeout(() => runApply(false), READER_ANCHOR_RESTORE_SETTLE_MS + 50);
    runApply(false);

    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!isFontsCancelled) runApply(false);
      });
    }

    return () => {
      teardown();
      // Strict Mode replays setup → cleanup → setup. Releasing an in-flight
      // restore lets the replayed setup re-attach stabilization; a settled or
      // cancelled restore keeps its marker so a later dependency change cannot
      // re-apply the anchor over the reader's position.
      const released = releaseAnchorRestoreMarkers({
        partId,
        restoredPartId: restoredPartRef.current,
        restore: anchorRestoreRef.current,
      });
      restoredPartRef.current = released.restoredPartId;
      anchorRestoreRef.current = released.restore;
    };
  }, [activePartId, loadedPartId, stateQuery.isSuccess]);

  const scheduleAnchorSave = useCallback((ratio: number) => {
    const saveState = anchorSaveRef.current;
    const now = Date.now();
    // A restore is still writing scrollTop; those scroll events are not reader intent.
    if (isAnchorRestorePending(anchorRestoreRef.current, now)) return;
    if (
      !shouldPersistAnchor({ lastSavedRatio: saveState.lastSavedRatio, lastSavedAt: saveState.lastSavedAt, now, ratio })
    ) {
      saveState.pendingRatio = ratio;
      if (saveState.timer == null) {
        const delay = Math.max(0, READER_ANCHOR_THROTTLE_MS - (now - saveState.lastSavedAt));
        saveState.timer = setTimeout(() => {
          saveState.timer = null;
          const pending = saveState.pendingRatio;
          if (pending == null) return;
          const at = Date.now();
          if (
            !shouldPersistAnchor({
              lastSavedRatio: saveState.lastSavedRatio,
              lastSavedAt: saveState.lastSavedAt,
              now: at,
              ratio: pending,
            })
          ) {
            return;
          }
          saveState.lastSavedRatio = pending;
          saveState.lastSavedAt = at;
          saveState.pendingRatio = null;
          persistAnchorRef.current(pending);
        }, delay);
      }
      return;
    }
    saveState.lastSavedRatio = ratio;
    saveState.lastSavedAt = now;
    saveState.pendingRatio = null;
    persistAnchorRef.current(ratio);
  }, []);

  // Single ref-driven flush for lifecycle writes. It captures the live scroll
  // ratio (falling back to a scheduled one) and always re-sends with keepalive,
  // so a position whose last request was an immediate non-keepalive save that
  // unload aborts is not lost. Deduped so visibility + pagehide + unmount do
  // not repeat the same write. Returns when the request settles so chapter
  // navigation can await the old chapter before switching parts.
  const flushAnchorSave = useCallback(async (): Promise<void> => {
    const partId = activePartIdRef.current;
    if (!partId) return;
    const saveState = anchorSaveRef.current;
    if (saveState.timer != null) {
      clearTimeout(saveState.timer);
      saveState.timer = null;
    }
    const pending = saveState.pendingRatio;
    saveState.pendingRatio = null;
    // Nothing was ever observed or restored for this part; do not write a no-op anchor.
    if (saveState.lastSavedRatio == null && pending == null) return;
    const container = contentRef.current;
    const isRestorePending = isAnchorRestorePending(anchorRestoreRef.current, Date.now());
    const ratio = resolveAnchorFlushRatio({
      containerRatio: container ? scrollPositionRatio(container) : null,
      pendingRatio: pending,
      lastFlushedRatio: saveState.lastFlushedRatio,
      isRestorePending,
    });
    if (ratio == null) return;
    saveState.lastFlushedRatio = ratio;
    saveState.lastSavedRatio = ratio;
    saveState.lastSavedAt = Date.now();
    await saveReadingAnchor(workId, { partId, ratio }, { keepalive: true }).catch(() => {});
  }, [workId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const flush = () => {
      void flushAnchorSave();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flushAnchorSave, isAuthenticated]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const resetAudioPlayback = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setWordTimings(null);
    setListeningSentenceIndex(null);
    clearListenHighlight();
    setAudioStatus('idle');
  }, [clearListenHighlight]);

  const navigateToPart = useCallback(
    async (partId: string, mode: 'navigate' | 'complete_chapter', nextPartId?: string) => {
      if (!isAuthenticated) {
        openLogin({ reason: 'sync' });
        return;
      }
      try {
        await flushAnchorSave();
        const updated =
          mode === 'navigate'
            ? await stateMutation.mutateAsync({ action: 'navigate', partId })
            : await stateMutation.mutateAsync({ action: 'complete_chapter', nextPartId });
        setLocalProgressRatio(updated.progressRatio);
        resetAudioPlayback();
        setActivePartId(updated.currentPartId ?? partId);
        router.replace(`/read/${workId}?part=${encodeURIComponent(updated.currentPartId ?? partId)}`, {
          scroll: false,
        });
      } catch (error) {
        if (isReadingStateRevisionConflict(error)) {
          const refreshed = await refetchState();
          const recovered = refreshed.data;
          if (recovered) {
            setLocalProgressRatio(recovered.progressRatio);
            resetAudioPlayback();
            const recoveredPartId = recovered.currentPartId ?? partId;
            setActivePartId(recoveredPartId);
            router.replace(`/read/${workId}?part=${encodeURIComponent(recoveredPartId)}`, { scroll: false });
          }
          toast.info(t(locale, 'content.reader.toast.stateRefreshed'));
          return;
        }
        toast.error(formatReaderApiError(error));
      }
    },
    [
      flushAnchorSave,
      isAuthenticated,
      locale,
      openLogin,
      refetchState,
      resetAudioPlayback,
      router,
      stateMutation,
      workId,
    ],
  );

  function clearSelectionUi() {
    setSelection(null);
    setSelectedSentenceIndex(null);
    setDictionaryState(null);
    window.getSelection()?.removeAllRanges();
  }

  function requestInlineAssist(kind: 'explain' | 'translate') {
    if (!selection) return;
    void assist.runInlineAssist(kind, selection);
  }

  async function playPartAudio(role: ReaderAudioRole) {
    if (!reader) return;
    if (!reader.audioAvailable[role]) {
      toast.error(
        role === 'us' ? t(locale, 'content.reader.toast.noUsAudio') : t(locale, 'content.reader.toast.noUkAudio'),
      );
      return;
    }

    setAudioStatus('loading');
    try {
      const track = await getReaderAudioTrack(reader.partId, role);
      audioRef.current?.pause();
      const audio = new Audio(track.audioUrl);
      audio.playbackRate = playbackRate;
      audioRef.current = audio;
      setWordTimings(track.wordTimings.length > 0 ? track.wordTimings : null);
      audio.onended = () => {
        clearListenHighlight();
        setAudioStatus('ready');
      };
      audio.onerror = () => {
        clearListenHighlight();
        setAudioStatus('failed');
        toast.error(t(locale, 'content.reader.toast.audioPlayFailed'));
      };
      await audio.play();
      setAudioStatus('playing');
    } catch {
      setWordTimings(null);
      clearListenHighlight();
      setAudioStatus('failed');
      toast.error(t(locale, 'content.reader.toast.audioPlayFailed'));
    }
  }

  function handleCyclePlaybackRate() {
    const next = nextPlaybackRate(playbackRate);
    setPlaybackRate(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  }

  async function handleTtsToggle() {
    if (!reader) return;

    if (audioStatus === 'playing') {
      audioRef.current?.pause();
      setAudioStatus('paused');
      return;
    }

    if (audioStatus === 'paused') {
      await audioRef.current?.play();
      setAudioStatus('playing');
      return;
    }

    const role = resolveAudioRole(reader.audioAvailable, preferredAudioRole);
    if (!role) {
      toast.error(t(locale, 'content.reader.toast.noAudio'));
      return;
    }

    await playPartAudio(role);
  }

  async function handleAccentSelect(role: ReaderAudioRole) {
    if (!reader) return;
    if (!reader.audioAvailable[role]) {
      toast.error(
        role === 'us' ? t(locale, 'content.reader.toast.noUsAudio') : t(locale, 'content.reader.toast.noUkAudio'),
      );
      return;
    }
    if (role === resolveAudioRole(reader.audioAvailable, preferredAudioRole)) {
      return;
    }
    setPreferredAudioRole(role);
    await playPartAudio(role);
  }

  async function handleFinish() {
    if (!isAuthenticated) {
      openLogin({ reason: 'sync' });
      return;
    }
    try {
      await flushAnchorSave();
      const updated = await stateMutation.mutateAsync({ action: 'finish' });
      setLocalProgressRatio(updated.progressRatio);
      router.push('/library');
    } catch (error) {
      if (isReadingStateRevisionConflict(error)) {
        const refreshed = await refetchState();
        const recovered = refreshed.data;
        if (recovered?.status === 'completed') {
          router.push('/library');
        } else if (recovered) {
          setLocalProgressRatio(recovered.progressRatio);
          const recoveredPartId = recovered.currentPartId ?? activePartId;
          if (recoveredPartId) {
            setActivePartId(recoveredPartId);
            router.replace(`/read/${workId}?part=${encodeURIComponent(recoveredPartId)}`, { scroll: false });
            toast.info(t(locale, 'content.reader.toast.stateRefreshed'));
          }
        }
        return;
      }
      toast.error(formatReaderApiError(error));
    }
  }

  const isWaitingForReadingStateBootstrap =
    isAuthenticated && !stateQuery.isError && (stateQuery.isPending || (Boolean(partsData) && activePartId === null));

  // Disabled part queries stay isPending in TanStack Query v5; only wait when a part is selected.
  const isLoading =
    partsQuery.isPending || (Boolean(activePartId) && partQuery.isPending) || isWaitingForReadingStateBootstrap;

  if (isLoading) {
    return (
      <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-background">
        <ReaderPartSkeleton />
      </div>
    );
  }

  if (partsQuery.isError || partQuery.isError || stateQuery.isError || !reader) {
    return (
      <ReaderUnavailable
        onRetry={() => {
          void partsQuery.refetch();
          void partQuery.refetch();
          void stateQuery.refetch();
        }}
        message={
          partsQuery.error
            ? formatReaderApiError(partsQuery.error)
            : partQuery.error
              ? formatReaderApiError(partQuery.error)
              : stateQuery.error
                ? formatReaderApiError(stateQuery.error)
                : undefined
        }
      />
    );
  }

  const currentIndex = partIndex(reader.parts, reader.partId);
  const nextPart = adjacentPart(reader.parts, reader.partId, 'next');
  const prevPart = adjacentPart(reader.parts, reader.partId, 'prev');
  const progressRatio = localProgressRatio ?? stateData?.progressRatio ?? reader.state?.progressRatio ?? 0;
  const chapterLabel =
    reader.parts.length > 1 && currentIndex >= 0 ? `${currentIndex + 1} / ${reader.parts.length}` : null;
  const audioRole = resolveAudioRole(reader.audioAvailable, preferredAudioRole) ?? 'us';
  const isDrawerOpen = assist.aiMode === 'drawer';
  const isInlineOpen = assist.aiMode === 'inline' && Boolean(assist.inlineSession);

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-background">
      <ReaderTocSidebar
        open={isTocOpen}
        onOpenChange={setIsTocOpen}
        reader={{ ...reader, state: reader.state }}
        currentPartId={reader.partId}
        onSelectChapter={(partId) => void navigateToPart(partId, 'navigate')}
      />

      <ReaderChrome
        visible={isChromeVisible}
        workTitle={reader.workTitle}
        partTitle={reader.partTitle}
        chapterLabel={chapterLabel}
        progressRatio={progressRatio}
        fontSize={fontSize}
        aiOpen={isDrawerOpen}
        tocOpen={isTocOpen}
        isListening={audioStatus === 'playing' || audioStatus === 'paused' || audioStatus === 'loading'}
        isBilingual={translate.isActive}
        isBilingualLoading={translate.isLoading}
        onToggleToc={() => {
          setIsTocOpen((v) => !v);
          setIsChromeVisible(true);
        }}
        onToggleFontSize={() => setFontSize((f) => FONT_CYCLE[(FONT_CYCLE.indexOf(f) + 1) % FONT_CYCLE.length]!)}
        onToggleAi={() => {
          if (assist.aiMode === 'drawer') {
            assist.closeAiSurface();
          } else {
            assist.openDrawer();
          }
          setIsChromeVisible(true);
        }}
        onToggleTts={() => {
          void handleTtsToggle();
          setIsChromeVisible(true);
        }}
        onToggleBilingual={() => {
          translate.toggleBilingual();
          setIsChromeVisible(true);
        }}
      />

      <ReaderPart
        partId={reader.partId}
        html={reader.html}
        fontSize={fontSize}
        aiDrawerOpen={isDrawerOpen}
        tocOpen={isTocOpen}
        isBilingual={translate.isActive}
        bilingualData={
          translate.isActive
            ? {
                sentences: translate.sentences,
                translationsByIndex: translate.translationsByIndex,
                titleZh: translate.titleZh,
                isLoading: translate.isLoading,
                isStreaming: translate.isStreaming,
                error: translate.error,
              }
            : null
        }
        focusedSentenceIndex={selectedSentenceIndex ?? tappedSentenceIndex ?? listeningSentenceIndex}
        onSentenceClick={(idx) => {
          setTappedSentenceIndex((prev) => (prev === idx ? null : idx));
        }}
        contentRef={contentRef}
        onSelectText={(payload) => {
          setSelection(payload);
          setSelectedSentenceIndex(payload.sentenceIndex ?? null);
          setDictionaryState(null);
          assist.closeAiSurface();
          assist.resetInline();
        }}
        onCenterTap={() => {
          setIsChromeVisible((v) => !v);
          if (selection && assist.aiMode !== 'inline') clearSelectionUi();
        }}
        onScroll={(event) => {
          scheduleAnchorSave(scrollPositionRatio(event.currentTarget));
        }}
        footer={
          <ReaderChapterNav
            parts={reader.parts}
            currentPartId={reader.partId}
            nextTitle={nextPart?.title ?? null}
            hasNext={Boolean(nextPart)}
            isLastChapter={!nextPart}
            onPrevious={() => {
              if (prevPart) void navigateToPart(prevPart.id, 'navigate');
            }}
            onNext={() => {
              if (nextPart) void navigateToPart(reader.partId, 'complete_chapter', nextPart.id);
            }}
            onFinish={() => void handleFinish()}
          />
        }
      />

      <ReaderSelectionToolbar
        visible={Boolean(selection) && assist.aiMode === 'closed' && !dictionaryState}
        rect={selection?.rect}
        top={selection?.top ?? 0}
        left={selection?.left ?? 0}
        onExplain={() => requestInlineAssist('explain')}
        onAskAi={() => {
          if (selection) assist.openInlineQuestion(selection);
        }}
        onLookup={() => {
          if (!selection) return;
          const clean = selection.quote.trim().replace(/^[^\w]+|[^\w]+$/g, '');
          const targetWord = clean || selection.quote.trim();
          if (!targetWord) return;

          setDictionaryState({
            word: targetWord,
            contextSentence: selection.contextSentence,
            rect: selection.rect,
            top: selection.top,
            left: selection.left,
          });
          assist.closeAiSurface();
        }}
        onTranslate={() => requestInlineAssist('translate')}
      />

      <ReaderDictionaryView
        open={Boolean(dictionaryState)}
        word={dictionaryState?.word ?? ''}
        entry={dictionaryQuery.data}
        isLoading={dictionaryQuery.isPending}
        isError={dictionaryQuery.isError}
        contextSentence={dictionaryState?.contextSentence}
        onRetry={() => void dictionaryQuery.refetch()}
        rect={dictionaryState?.rect}
        top={dictionaryState?.top}
        left={dictionaryState?.left}
        onAskAi={(word, contextSentence) => {
          const currentSelection = selection ?? {
            quote: word,
            paragraphId: `${activePartId}-p1`,
            contextSentence,
            top: dictionaryState?.top ?? 0,
            left: dictionaryState?.left ?? 0,
          };
          setDictionaryState(null);
          void assist.runInlineAssist('ask', currentSelection, formatDictionaryWordDeepDivePrompt(word, locale));
        }}
        onClose={() => {
          setDictionaryState(null);
          clearSelectionUi();
        }}
      />

      <ReaderAiInline
        open={isInlineOpen}
        quote={assist.inlineSession?.quote ?? ''}
        answer={assist.inlineSession?.answer ?? ''}
        streaming={assist.isInlineStreaming}
        mode={assist.inlineSession?.mode ?? 'answer'}
        canOpenDrawer={Boolean(assist.inlineSession?.conversationId)}
        error={assist.error}
        rect={selection?.rect}
        top={(selection?.top ?? 0) + 48}
        left={selection?.left ?? 0}
        onSubmitQuestion={(question) => {
          if (selection) void assist.runInlineAssist('ask', selection, question);
        }}
        onClose={() => {
          assist.closeAiSurface();
          clearSelectionUi();
        }}
        onOpenDrawer={assist.openInlineConversationInDrawer}
      />

      <ReaderAiDrawer
        open={isDrawerOpen}
        quote={selection?.quote ?? assist.activeQuote}
        messages={assist.messages}
        suggestions={assist.suggestions}
        conversations={assist.conversations}
        activeConversationId={assist.activeConversationId}
        isHistoryLoading={assist.isHistoryLoading}
        historyError={assist.historyError}
        onRetryHistory={() => void assist.refetchHistory()}
        isSending={assist.isDrawerSending}
        error={assist.error}
        onOpenChange={(open) => (open ? assist.openDrawer() : assist.closeAiSurface())}
        onSend={(text) => {
          const currentSelection = selection;
          clearSelectionUi();
          assist.clearActiveQuote();
          void assist.sendDrawerMessage(text, currentSelection);
        }}
        onClearQuote={() => {
          clearSelectionUi();
          assist.clearActiveQuote();
        }}
        onSelectConversation={(conversationId) => void assist.restoreConversation(conversationId)}
        onStartNewConversation={() => {
          assist.startNewDrawerConversation();
          clearSelectionUi();
        }}
      />

      <ReaderTts
        status={audioStatus}
        playbackRate={playbackRate}
        tocOpen={isTocOpen}
        aiDrawerOpen={isDrawerOpen}
        audioRole={audioRole}
        audioAvailable={reader.audioAvailable}
        onToggle={() => void handleTtsToggle()}
        onCyclePlaybackRate={handleCyclePlaybackRate}
        onSelectRole={(role) => void handleAccentSelect(role)}
      />
    </div>
  );
}
