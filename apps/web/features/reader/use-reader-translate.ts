'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { TranslateSentenceEn } from '@gloaming/shared/translate';

import { streamTranslatePart } from '@/features/reader/reader-translate-api';
import { ApiRequestError } from '@/lib/api-request';

type UseReaderTranslateOptions = {
  partId: string | null;
  isAuthenticated: boolean;
  openLogin?: (input: { reason: 'ai' }) => void;
};

type TranslationState = {
  partId: string | null;
  isActive: boolean;
  isLoading: boolean;
  isStreaming: boolean;
  sentences: TranslateSentenceEn[];
  translationsByIndex: Record<number, string>;
  titleZh: string | null;
  contentHash: string | null;
  isCached: boolean | null;
  error: string | null;
};

const INITIAL_STATE: TranslationState = {
  partId: null,
  isActive: false,
  isLoading: false,
  isStreaming: false,
  sentences: [],
  translationsByIndex: {},
  titleZh: null,
  contentHash: null,
  isCached: null,
  error: null,
};

export function useReaderTranslate({ partId, isAuthenticated, openLogin }: UseReaderTranslateOptions) {
  const [state, setState] = useState<TranslationState>(INITIAL_STATE);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Derived state: if partId has changed, treat as inactive and un-translated until initiated
  const isCurrentPart = state.partId === partId;
  const current = isCurrentPart ? state : INITIAL_STATE;

  const stopTranslate = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      isLoading: false,
      isStreaming: false,
    }));
  }, []);

  const resetState = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState(INITIAL_STATE);
  }, []);

  // Abort ongoing translation when partId changes or unmounts
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [partId]);

  const startTranslate = useCallback(async () => {
    if (!partId) {
      return;
    }
    if (!isAuthenticated) {
      if (openLogin) {
        openLogin({ reason: 'ai' });
      } else {
        toast.error('请先登录以使用双语阅读');
      }
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setState({
      partId,
      isActive: true,
      isLoading: true,
      isStreaming: false,
      sentences: [],
      translationsByIndex: {},
      titleZh: null,
      contentHash: null,
      isCached: null,
      error: null,
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await streamTranslatePart(
        { partId },
        {
          signal: controller.signal,
          onMeta: (meta) => {
            setState((prev) => ({
              ...prev,
              contentHash: meta.contentHash,
              sentences: meta.sentences,
              isLoading: false,
              isStreaming: true,
            }));
          },
          onTitle: (title) => {
            setState((prev) => ({
              ...prev,
              titleZh: title.zh,
            }));
          },
          onSentence: (sentence) => {
            setState((prev) => ({
              ...prev,
              translationsByIndex: {
                ...prev.translationsByIndex,
                [sentence.index]: sentence.zh,
              },
            }));
          },
          onDone: (done) => {
            setState((prev) => ({
              ...prev,
              isCached: done.cached,
              isLoading: false,
              isStreaming: false,
            }));
          },
        },
      );
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }

      if (err instanceof ApiRequestError && err.status === 401) {
        setState((prev) => ({
          ...prev,
          isActive: false,
          isLoading: false,
          isStreaming: false,
        }));
        if (openLogin) {
          openLogin({ reason: 'ai' });
        } else {
          toast.error('登录已过期，请重新登录');
        }
        return;
      }

      const message = err instanceof Error ? err.message : '翻译请求失败';
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isStreaming: false,
        error: message,
      }));
      toast.error(message);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [partId, isAuthenticated, openLogin]);

  const toggleBilingual = useCallback(() => {
    if (current.isActive) {
      stopTranslate();
      setState((prev) => ({
        ...prev,
        isActive: false,
      }));
    } else {
      void startTranslate();
    }
  }, [current.isActive, startTranslate, stopTranslate]);

  return {
    isActive: current.isActive,
    isLoading: current.isLoading,
    isStreaming: current.isStreaming,
    sentences: current.sentences,
    translationsByIndex: current.translationsByIndex,
    titleZh: current.titleZh,
    contentHash: current.contentHash,
    isCached: current.isCached,
    error: current.error,
    toggleBilingual,
    startTranslate,
    stopTranslate,
    resetState,
  };
}
