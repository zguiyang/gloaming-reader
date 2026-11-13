'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { AssistAskBody } from '@/shared/assist';
import type { ConversationDetail, ConversationSummary } from '@/shared/conversations';

import { streamAssistAsk } from '@/features/reader/assist/reader-assist-api';
import {
  getReaderAssistConversation,
  readerConversationsQueryKey,
  useReaderAssistConversationsQuery,
} from '@/features/reader/assist/reader-conversations-api';
import { formatReaderApiError } from '@/features/reader/reader-api';
import {
  formatInlineAssistPrompt,
  type ReaderAiMessage,
  type ReaderAiMessageSource,
  type ReaderAiMode,
  type ReaderInlineAssistKind,
  type ReaderSelection,
  type ReaderSelectionRect,
} from '@/features/reader/reader-model';
import { ApiRequestError } from '@/lib/api-request';
import { useLocale } from '@/lib/locale-context';

export type InlineAssistKind = ReaderInlineAssistKind;

export type ReaderInlineSession = {
  kind: InlineAssistKind;
  quote: string;
  paragraphId: string;
  contextSentence?: string;
  /** Captured at request time so the popover keeps its anchor after focus/selection changes. */
  rect?: ReaderSelectionRect;
  top: number;
  left: number;
  question?: string;
  answer: string;
  conversationId?: string;
  mode: 'answer' | 'question';
};

type OpenLogin = (input: { reason: 'ai' }) => void;

type UseReaderAssistOptions = {
  workId: string;
  partId: string | null;
  isAuthenticated: boolean;
  openLogin: OpenLogin;
};

type AssistRequestInput = {
  workId: string;
  partId: string;
  kind: InlineAssistKind;
  selection?: string;
  question?: string;
  conversationId?: string;
};

function actionIdForKind(kind: InlineAssistKind): AssistAskBody['actionId'] {
  if (kind === 'translate') return 'meaning';
  if (kind === 'ask') return 'qa';
  return 'explain';
}

function messageId(role: ReaderAiMessage['role']): string {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildAssistRequestBody(input: AssistRequestInput): AssistAskBody {
  const body: AssistAskBody = {
    workId: input.workId,
    partId: input.partId,
    actionId: actionIdForKind(input.kind),
  };

  const selection = input.selection?.trim();
  if (selection) {
    body.selection = selection;
  }

  const question = input.question?.trim();
  if (input.kind === 'ask') {
    if (!question) {
      throw new Error('Question is required for reader AI Q&A');
    }
    body.question = question;
  }

  if (input.conversationId) {
    body.conversationId = input.conversationId;
  }

  return body;
}

export function buildInlineAssistRequestBody(input: Omit<AssistRequestInput, 'conversationId'>): AssistAskBody {
  return buildAssistRequestBody(input);
}

export function buildDrawerAssistRequestBody(input: AssistRequestInput): AssistAskBody {
  return buildAssistRequestBody(input);
}

export function conversationDetailToReaderAiMessages(detail: ConversationDetail): ReaderAiMessage[] {
  return detail.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    source: 'drawer',
  }));
}

export function useReaderAssist({ workId, partId, isAuthenticated, openLogin }: UseReaderAssistOptions) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const historyQuery = useReaderAssistConversationsQuery(workId, {
    enabled: isAuthenticated && Boolean(workId),
  });

  const [aiMode, setAiMode] = useState<ReaderAiMode>('closed');
  const [inlineSession, setInlineSession] = useState<ReaderInlineSession | null>(null);
  const [isInlineStreaming, setIsInlineStreaming] = useState(false);
  const [messages, setMessages] = useState<ReaderAiMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>();
  const [activeQuote, setActiveQuote] = useState<string | null>(null);
  const [isDrawerSending, setIsDrawerSending] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The inline popover and the drawer are independent surfaces. Each owns its
  // controller so starting one can never abort the other's in-flight stream —
  // sharing a single ref let an inline request kill a drawer stream, whose
  // catch path returned before clearing `isDrawerSending` and left the drawer
  // input disabled until a full reload.
  const inlineAbortRef = useRef<AbortController | null>(null);
  const drawerAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      inlineAbortRef.current?.abort();
      drawerAbortRef.current?.abort();
    };
  }, []);

  const conversations = useMemo<ConversationSummary[]>(
    () => historyQuery.data?.items ?? [],
    [historyQuery.data?.items],
  );

  function invalidateHistory() {
    void queryClient.invalidateQueries({ queryKey: readerConversationsQueryKey.list(workId) });
  }

  function handleAssistError(error: unknown): boolean {
    if (error instanceof ApiRequestError && error.status === 401) {
      openLogin({ reason: 'ai' });
      return true;
    }
    const message = formatReaderApiError(error);
    setError(message);
    toast.error(message);
    return false;
  }

  function closeAiSurface() {
    setAiMode('closed');
  }

  function resetInline() {
    setInlineSession(null);
    setIsInlineStreaming(false);
  }

  function openDrawer(conversationId?: string) {
    if (conversationId) {
      setActiveConversationId(conversationId);
    }
    setAiMode('drawer');
  }

  function startNewDrawerConversation() {
    setActiveConversationId(undefined);
    setActiveQuote(null);
    setMessages([]);
    setSuggestions([]);
    setError(null);
    setAiMode('drawer');
  }

  function openInlineQuestion(selection: ReaderSelection) {
    setError(null);
    setInlineSession({
      kind: 'ask',
      quote: selection.quote,
      paragraphId: selection.paragraphId,
      contextSentence: selection.contextSentence,
      rect: selection.rect,
      top: selection.top,
      left: selection.left,
      answer: '',
      mode: 'question',
    });
    setAiMode('inline');
  }

  function selectionFromInlineSession(session: ReaderInlineSession): ReaderSelection {
    return {
      quote: session.quote,
      paragraphId: session.paragraphId,
      contextSentence: session.contextSentence,
      rect: session.rect,
      top: session.top,
      left: session.left,
    };
  }

  async function runInlineAssist(kind: Exclude<InlineAssistKind, 'ask'>, selection: ReaderSelection): Promise<void>;
  async function runInlineAssist(kind: 'ask', selection: ReaderSelection, question: string): Promise<void>;
  async function runInlineAssist(kind: InlineAssistKind, selection: ReaderSelection, question?: string): Promise<void> {
    if (!partId) return;

    inlineAbortRef.current?.abort();
    const controller = new AbortController();
    inlineAbortRef.current = controller;
    const userContent = formatInlineAssistPrompt(locale, kind, selection.quote, question);

    setError(null);
    setAiMode('inline');
    setIsInlineStreaming(true);
    setInlineSession({
      kind,
      quote: selection.quote,
      paragraphId: selection.paragraphId,
      contextSentence: selection.contextSentence,
      rect: selection.rect,
      top: selection.top,
      left: selection.left,
      question,
      answer: '',
      mode: 'answer',
    });

    try {
      const done = await streamAssistAsk(
        buildInlineAssistRequestBody({
          workId,
          partId,
          kind,
          selection: selection.quote,
          question,
        }),
        {
          signal: controller.signal,
          onDelta: (text) => {
            setInlineSession((current) => (current ? { ...current, answer: current.answer + text } : current));
          },
        },
      );

      setInlineSession((current) =>
        current
          ? {
              ...current,
              answer: done.reply,
              conversationId: done.conversationId ?? current.conversationId,
            }
          : current,
      );
      setIsInlineStreaming(false);

      if (done.conversationId) {
        setActiveConversationId(done.conversationId);
        setActiveQuote(selection.quote);
      }
      if (done.suggestions?.length) {
        setSuggestions(done.suggestions);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: messageId('user'),
          role: 'user',
          content: userContent,
          source: 'inline',
          anchor: { paragraphId: selection.paragraphId, selectedText: selection.quote },
        },
        {
          id: messageId('assistant'),
          role: 'assistant',
          content: done.reply,
          source: 'inline',
          anchor: { paragraphId: selection.paragraphId, selectedText: selection.quote },
        },
      ]);
      invalidateHistory();
    } catch (error) {
      // A newer request owns this surface now; touching state would clear its flag.
      if (inlineAbortRef.current !== controller) return;
      setIsInlineStreaming(false);
      if (controller.signal.aborted) return;
      handleAssistError(error);
    }
  }

  function submitInlineQuestion(question: string) {
    if (!inlineSession) return;
    void runInlineAssist('ask', selectionFromInlineSession(inlineSession), question);
  }

  function retryInlineAssist() {
    if (!inlineSession) return;
    const selection = selectionFromInlineSession(inlineSession);
    if (inlineSession.kind === 'ask') {
      if (!inlineSession.question) return;
      void runInlineAssist('ask', selection, inlineSession.question);
      return;
    }
    void runInlineAssist(inlineSession.kind, selection);
  }

  async function sendDrawerMessage(text: string, selection?: ReaderSelection | null) {
    const question = text.trim();
    if (!question || !partId || isDrawerSending) return;

    const quoteToUse = selection?.quote ?? activeQuote ?? undefined;

    drawerAbortRef.current?.abort();
    const controller = new AbortController();
    drawerAbortRef.current = controller;
    const userMessage: ReaderAiMessage = {
      id: messageId('user'),
      role: 'user',
      content: question,
      source: 'drawer',
      anchor: selection
        ? { paragraphId: selection.paragraphId, selectedText: selection.quote }
        : activeQuote
          ? { paragraphId: `${partId}-selection`, selectedText: activeQuote }
          : undefined,
    };
    const assistantId = messageId('assistant');
    const assistantMessage: ReaderAiMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      source: 'drawer',
      anchor: userMessage.anchor,
    };

    setError(null);
    setAiMode('drawer');
    setIsDrawerSending(true);
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setActiveQuote(null);

    try {
      const done = await streamAssistAsk(
        buildDrawerAssistRequestBody({
          workId,
          partId,
          kind: 'ask',
          selection: quoteToUse,
          question,
          conversationId: activeConversationId,
        }),
        {
          signal: controller.signal,
          onDelta: (delta) => {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)));
          },
        },
      );

      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: done.reply } : m)));
      if (done.conversationId) {
        setActiveConversationId(done.conversationId);
      }
      setSuggestions(done.suggestions ?? []);
      setIsDrawerSending(false);
      invalidateHistory();
    } catch (error) {
      if (drawerAbortRef.current !== controller) return;
      // Always release the guard, including on abort: `sendDrawerMessage`
      // early-returns on `isDrawerSending`, so a skipped reset left the drawer
      // input and send button disabled for the rest of the session.
      setIsDrawerSending(false);
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      if (controller.signal.aborted) return;
      handleAssistError(error);
    }
  }

  async function restoreConversation(conversationId: string) {
    setIsHistoryLoading(true);
    setError(null);
    try {
      const detail = await getReaderAssistConversation(conversationId);
      setActiveConversationId(detail.id);
      setMessages(conversationDetailToReaderAiMessages(detail));
      setSuggestions([]);
      setActiveQuote(null);
      setAiMode('drawer');
    } catch (error) {
      handleAssistError(error);
    } finally {
      setIsHistoryLoading(false);
    }
  }

  function openInlineConversationInDrawer() {
    openDrawer(inlineSession?.conversationId ?? activeConversationId);
  }

  function clearActiveQuote() {
    setActiveQuote(null);
  }

  return {
    aiMode,
    setAiMode,
    closeAiSurface,
    inlineSession,
    resetInline,
    isInlineStreaming,
    openInlineQuestion,
    runInlineAssist,
    submitInlineQuestion,
    retryInlineAssist,
    openInlineConversationInDrawer,
    activeConversationId,
    activeQuote,
    clearActiveQuote,
    messages,
    suggestions,
    conversations,
    isHistoryLoading: isHistoryLoading || historyQuery.isPending,
    historyError: historyQuery.error,
    refetchHistory: historyQuery.refetch,
    isDrawerSending,
    error,
    openDrawer,
    startNewDrawerConversation,
    sendDrawerMessage,
    restoreConversation,
  };
}

export type { ReaderAiMessageSource };
