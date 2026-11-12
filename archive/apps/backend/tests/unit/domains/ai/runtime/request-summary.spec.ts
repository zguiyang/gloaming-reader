import { describe, expect, it } from 'vitest';

import { buildRequestSummary } from '@/domains/ai/runtime/request-summary';

describe('buildRequestSummary', () => {
  it('keeps invocation metrics and safe identifiers without message content', () => {
    const summary = buildRequestSummary(
      {
        messages: [
          { role: 'user', content: 'private selection' },
          { role: 'assistant', content: 'private prior response' },
          { role: 'user', content: 'private follow-up' },
        ],
        requestSummaryExtra: { actionId: 'meaning', phase: 'followups', workId: 'work_123' },
      },
      1,
    );

    expect(summary).toEqual({
      messageCount: 3,
      selectionLength: 35,
      toolRoundCount: 1,
      actionId: 'meaning',
      phase: 'followups',
      workId: 'work_123',
    });
    expect(JSON.stringify(summary)).not.toContain('private');
  });
});
