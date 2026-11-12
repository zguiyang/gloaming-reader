import { useQuery } from '@tanstack/react-query';

import {
  type ConversationDetail,
  conversationDetailSchema,
  type ConversationListData,
  conversationListDataSchema,
} from '@gloaming/shared/conversations';

import { apiRequest } from '@/lib/api-request';

export const readerConversationsQueryKey = {
  all: ['reader', 'conversations'] as const,
  list: (workId: string) => [...readerConversationsQueryKey.all, 'list', workId] as const,
  detail: (conversationId: string) => [...readerConversationsQueryKey.all, 'detail', conversationId] as const,
};

export async function getReaderAssistConversations(
  workId: string,
  init?: { signal?: AbortSignal },
): Promise<ConversationListData> {
  const qs = new URLSearchParams({
    surface: 'assist-read',
    subjectType: 'reading_work',
    subjectId: workId,
  });

  return apiRequest(`/api/conversations?${qs}`, {
    schema: conversationListDataSchema,
    signal: init?.signal,
  });
}

export async function getReaderAssistConversation(
  conversationId: string,
  init?: { signal?: AbortSignal },
): Promise<ConversationDetail> {
  return apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    schema: conversationDetailSchema,
    signal: init?.signal,
  });
}

export function useReaderAssistConversationsQuery(workId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: readerConversationsQueryKey.list(workId),
    queryFn: ({ signal }) => getReaderAssistConversations(workId, { signal }),
    enabled: (options?.enabled ?? true) && Boolean(workId),
  });
}

export function useReaderAssistConversationQuery(conversationId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: readerConversationsQueryKey.detail(conversationId ?? ''),
    queryFn: ({ signal }) => getReaderAssistConversation(conversationId!, { signal }),
    enabled: (options?.enabled ?? true) && Boolean(conversationId),
  });
}
