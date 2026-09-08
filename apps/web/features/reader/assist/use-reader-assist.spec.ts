import { describe, expect, it } from 'vitest';

import type { ConversationDetail } from '@gloaming/shared/conversations';

import {
  buildDrawerAssistRequestBody,
  buildInlineAssistRequestBody,
  conversationDetailToReaderAiMessages,
} from '@/features/reader/assist/use-reader-assist';

describe('reader assist request body builders', () => {
  it('starts inline explain in a new conversation context', () => {
    expect(
      buildInlineAssistRequestBody({
        workId: 'work-1',
        partId: 'part-1',
        kind: 'explain',
        selection: '  selected text  ',
      }),
    ).toEqual({
      workId: 'work-1',
      partId: 'part-1',
      actionId: 'explain',
      selection: 'selected text',
    });
  });

  it('requires a real question for inline Q&A', () => {
    expect(() =>
      buildInlineAssistRequestBody({
        workId: 'work-1',
        partId: 'part-1',
        kind: 'ask',
        selection: 'selected text',
        question: '   ',
      }),
    ).toThrow('Question is required');

    expect(
      buildInlineAssistRequestBody({
        workId: 'work-1',
        partId: 'part-1',
        kind: 'ask',
        selection: 'selected text',
        question: ' What does this mean? ',
      }),
    ).toEqual({
      workId: 'work-1',
      partId: 'part-1',
      actionId: 'qa',
      selection: 'selected text',
      question: 'What does this mean?',
    });
  });

  it('resumes the active conversation for drawer follow-up', () => {
    expect(
      buildDrawerAssistRequestBody({
        workId: 'work-1',
        partId: 'part-1',
        kind: 'ask',
        question: 'Continue this thread',
        conversationId: 'conversation-1',
      }),
    ).toEqual({
      workId: 'work-1',
      partId: 'part-1',
      actionId: 'qa',
      question: 'Continue this thread',
      conversationId: 'conversation-1',
    });
  });

  it('starts a new drawer conversation when no active conversation is provided', () => {
    expect(
      buildDrawerAssistRequestBody({
        workId: 'work-1',
        partId: 'part-1',
        kind: 'ask',
        question: 'Start fresh',
      }),
    ).toEqual({
      workId: 'work-1',
      partId: 'part-1',
      actionId: 'qa',
      question: 'Start fresh',
    });
  });

  it('includes selection in drawer assist request when provided', () => {
    expect(
      buildDrawerAssistRequestBody({
        workId: 'work-1',
        partId: 'part-1',
        kind: 'ask',
        question: 'What does this paragraph mean?',
        selection: 'Important quote from text',
        conversationId: 'conversation-1',
      }),
    ).toEqual({
      workId: 'work-1',
      partId: 'part-1',
      actionId: 'qa',
      question: 'What does this paragraph mean?',
      selection: 'Important quote from text',
      conversationId: 'conversation-1',
    });
  });
});

describe('conversationDetailToReaderAiMessages', () => {
  it('maps persisted conversation messages into drawer messages without fake anchors', () => {
    const detail: ConversationDetail = {
      id: 'conversation-1',
      surface: 'assist-read',
      subjectType: 'reading_work',
      subjectId: 'work-1',
      preview: 'Selected text',
      endedAt: null,
      lastMessageAt: '2026-09-02T12:00:00.000Z',
      createdAt: '2026-09-02T12:00:00.000Z',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: 'Explain this',
          status: 'complete',
          metadata: { actionId: 'explain', selection: 'Selected text' },
          createdAt: '2026-09-02T12:00:00.000Z',
        },
        {
          id: 'message-2',
          role: 'assistant',
          content: 'It means...',
          status: 'complete',
          metadata: {},
          createdAt: '2026-09-02T12:00:01.000Z',
        },
      ],
    };

    expect(conversationDetailToReaderAiMessages(detail)).toEqual([
      {
        id: 'message-1',
        role: 'user',
        content: 'Explain this',
        source: 'drawer',
      },
      {
        id: 'message-2',
        role: 'assistant',
        content: 'It means...',
        source: 'drawer',
      },
    ]);
  });
});
