'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { TtsWordTiming } from '@gloaming/shared/tts';

import { useAuthDialog } from '@/features/auth';
import { ReaderAiDrawer } from '@/features/reader/reader-ai-drawer';
import { ReaderAiInline } from '@/features/reader/reader-ai-inline';
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
import { useReaderListenHighlight } from '@/features/reader/reader-audio-highlight';
import { ReaderChapterNav } from '@/features/reader/reader-chapter-nav';
import { ReaderChrome } from '@/features/reader/reader-chrome';
import { useDictionaryLookupQuery } from '@/features/reader/reader-dictionary-api';
import { ReaderDictionaryView } from '@/features/reader/reader-dictionary-view';
import { useReadingHeartbeat } from '@/features/reader/reader-heartbeat';
import type {
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
  nextPlaybackRate,
  partIndex,
  resolveAudioRole,
} from '@/features/reader/reader-model';
import { ReaderPart, ReaderPartSkeleton } from '@/features/reader/reader-part';
import { ReaderSelectionToolbar } from '@/features/reader/reader-selection-toolbar';
import { ReaderTocSidebar } from '@/features/reader/reader-toc-sidebar';
import { ReaderTts } from '@/features/reader/reader-tts';
import { ReaderUnavailable } from '@/features/reader/reader-unavailable';
import { useReaderAssist } from '@/features/reader/use-reader-assist';
import { useReaderTranslate } from '@/features/reader/use-reader-translate';
import { isReadingStateRevisionConflict } from '@/features/reading-state/reading-state-api';
import { authClient } from '@/lib/auth';

type ReaderPageProps = {
  workId: string;
};

const FONT_CYCLE: ReaderFontSize[] = ['sm', 'md', 'lg'];

export function ReaderPage({ workId }: ReaderPageProps) {
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
  const [isTapHintVisible, setIsTapHintVisible] = useState(true);
  const [wordTimings, setWordTimings] = useState<TtsWordTiming[] | null>(null);
  const [listeningSentenceIndex, setListeningSentenceIndex] = useState<number | null>(null);
  const [selectedSentenceIndex, setSelectedSentenceIndex] = useState<number | null>(null);
  const [tappedSentenceIndex, setTappedSentenceIndex] = useState<number | null>(null);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const partsData = partsQuery.data;
  const stateData = stateQuery.data ?? null;

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
    if (isAuthenticated && stateQuery.isPending) return;

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
  }, [partsData, stateData, stateQuery.isPending, isAuthenticated, preferredPartId, refetchState, stateMutation]);

  useEffect(() => {
    if (!partsData || !activePartId) return;
    scrollContainerRef.current?.scrollTo(0, 0);
  }, [activePartId, partsData]);

  useEffect(() => {
    if (!isTapHintVisible || !partsData) return;
    const t = window.setTimeout(() => setIsTapHintVisible(false), 3500);
    return () => window.clearTimeout(t);
  }, [isTapHintVisible, partsData]);

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
          toast.info('阅读状态已刷新，请继续阅读');
          return;
        }
        toast.error(formatReaderApiError(error));
      }
    },
    [isAuthenticated, openLogin, refetchState, resetAudioPlayback, router, stateMutation, workId],
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
      toast.error(role === 'us' ? '暂无美音' : '暂无英音');
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
      };
      await audio.play();
      setAudioStatus('playing');
    } catch (error) {
      setWordTimings(null);
      clearListenHighlight();
      setAudioStatus('failed');
      toast.error(formatReaderApiError(error));
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
      toast.error('暂无音频');
      return;
    }

    await playPartAudio(role);
  }

  async function handleAccentSelect(role: ReaderAudioRole) {
    if (!reader) return;
    if (!reader.audioAvailable[role]) {
      toast.error(role === 'us' ? '暂无美音' : '暂无英音');
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
      const updated = await stateMutation.mutateAsync({ action: 'finish' });
      setLocalProgressRatio(updated.progressRatio);
      router.push('/my-shelf');
    } catch (error) {
      if (isReadingStateRevisionConflict(error)) {
        const refreshed = await refetchState();
        const recovered = refreshed.data;
        if (recovered?.status === 'completed') {
          router.push('/my-shelf');
        } else if (recovered) {
          setLocalProgressRatio(recovered.progressRatio);
          const recoveredPartId = recovered.currentPartId ?? activePartId;
          if (recoveredPartId) {
            setActivePartId(recoveredPartId);
            router.replace(`/read/${workId}?part=${encodeURIComponent(recoveredPartId)}`, { scroll: false });
            toast.info('阅读状态已刷新，请继续阅读');
          }
        }
        return;
      }
      toast.error(formatReaderApiError(error));
    }
  }

  const isLoading =
    partsQuery.isPending ||
    partQuery.isPending ||
    (isAuthenticated && (stateQuery.isPending || (Boolean(partsData) && activePartId === null)));

  if (isLoading) {
    return (
      <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-background">
        <ReaderPartSkeleton />
      </div>
    );
  }

  if (partsQuery.isError || partQuery.isError || !reader) {
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
          setIsTapHintVisible(false);
          if (selection && assist.aiMode !== 'inline') clearSelectionUi();
        }}
        onScroll={(event) => {
          scrollContainerRef.current = event.currentTarget;
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
        contextSentence={dictionaryState?.contextSentence}
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
          void assist.runInlineAssist('ask', currentSelection, `请结合当前语境深入讲解单词 “${word}” 的含义与用法。`);
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

      {isTapHintVisible ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div className="rounded-full bg-[var(--inverse-surface)] px-5 py-2.5 text-sm text-[var(--inverse-on-surface)] shadow-card">
            点按中央显示菜单
          </div>
        </div>
      ) : null}
    </div>
  );
}
