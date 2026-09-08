'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { AssistAskBody } from '@gloaming/shared/assist';
import type { ConversationDetail, ConversationSummary } from '@gloaming/shared/conversations';

import { formatReaderApiError } from '@/features/reader/reader-api';
import { streamAssistAsk } from '@/features/reader/reader-assist-api';
import {
  getReaderAssistConversation,
  readerConversationsQueryKey,
  useReaderAssistConversationsQuery,
} from '@/features/reader/reader-conversations-api';
import type {
  ReaderAiMessage,
  ReaderAiMessageSource,
  ReaderAiMode,
  ReaderSelection,
} from '@/features/reader/reader-model';
import { ApiRequestError } from '@/lib/api-request';

export type InlineAssistKind = 'explain' | 'translate' | 'ask';

export type ReaderInlineSession = {
  kind: InlineAssistKind;
  quote: string;
  paragraphId: string;
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

function inlineUserPrompt(kind: InlineAssistKind, selectedText: string, question?: string): string {
  if (kind === 'translate') return `翻译：${selectedText}`;
  if (kind === 'ask') return question?.trim() || `询问：${selectedText}`;
  return `解释：${selectedText}`;
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
  const assistAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => assistAbortRef.current?.abort();
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
      answer: '',
      mode: 'question',
    });
    setAiMode('inline');
  }

  async function runInlineAssist(kind: Exclude<InlineAssistKind, 'ask'>, selection: ReaderSelection): Promise<void>;
  async function runInlineAssist(kind: 'ask', selection: ReaderSelection, question: string): Promise<void>;
  async function runInlineAssist(kind: InlineAssistKind, selection: ReaderSelection, question?: string): Promise<void> {
    if (!partId) return;

    assistAbortRef.current?.abort();
    const controller = new AbortController();
    assistAbortRef.current = controller;
    const userContent = inlineUserPrompt(kind, selection.quote, question);

    setError(null);
    setAiMode('inline');
    setIsInlineStreaming(true);
    setInlineSession({
      kind,
      quote: selection.quote,
      paragraphId: selection.paragraphId,
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
      if (controller.signal.aborted) {
        return;
      }
      setIsInlineStreaming(false);
      handleAssistError(error);
    }
  }

  async function sendDrawerMessage(text: string, selection?: ReaderSelection | null) {
    const question = text.trim();
    if (!question || !partId || isDrawerSending) return;

    const quoteToUse = selection?.quote ?? activeQuote ?? undefined;

    assistAbortRef.current?.abort();
    const controller = new AbortController();
    assistAbortRef.current = controller;
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
      if (controller.signal.aborted) {
        return;
      }
      setIsDrawerSending(false);
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
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
    openInlineConversationInDrawer,
    activeConversationId,
    activeQuote,
    clearActiveQuote,
    messages,
    suggestions,
    conversations,
    isHistoryLoading: isHistoryLoading || historyQuery.isPending,
    historyError: historyQuery.error,
    isDrawerSending,
    error,
    openDrawer,
    startNewDrawerConversation,
    sendDrawerMessage,
    restoreConversation,
  };
}

export type { ReaderAiMessageSource };
