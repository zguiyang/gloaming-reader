import { describe, expect, it } from 'vitest';

import { assistAskBodySchema, assistSseDoneSchema } from './assist.ts';

describe('assist ask body', () => {
  it('accepts gist without selection', () => {
    const parsed = assistAskBodySchema.parse({
      workId: 'work_1',
      partId: 'part_1',
      actionId: 'gist',
    });
    expect(parsed.actionId).toBe('gist');
    expect(parsed.selection).toBeUndefined();
  });

  it('accepts qa without selection when question is present', () => {
    const parsed = assistAskBodySchema.parse({
      workId: 'work_1',
      partId: 'part_1',
      actionId: 'qa',
      question: '这篇在讲什么？',
    });
    expect(parsed.question).toBe('这篇在讲什么？');
    expect(parsed.selection).toBeUndefined();
  });

  it('rejects qa without question', () => {
    const result = assistAskBodySchema.safeParse({
      workId: 'work_1',
      partId: 'part_1',
      actionId: 'qa',
    });
    expect(result.success).toBe(false);
  });

  it('rejects meaning without selection', () => {
    const result = assistAskBodySchema.safeParse({
      workId: 'work_1',
      partId: 'part_1',
      actionId: 'meaning',
    });
    expect(result.success).toBe(false);
  });

  it('accepts meaning with selection', () => {
    const parsed = assistAskBodySchema.parse({
      workId: 'work_1',
      partId: 'part_1',
      actionId: 'meaning',
      selection: 'The fox jumped.',
    });
    expect(parsed.selection).toBe('The fox jumped.');
  });

  it('accepts optional conversationId', () => {
    const parsed = assistAskBodySchema.parse({
      workId: 'work_1',
      partId: 'part_1',
      actionId: 'gist',
      conversationId: 'conv_1',
    });
    expect(parsed.conversationId).toBe('conv_1');
  });
});

describe('assist SSE done', () => {
  it('accepts done without suggestions', () => {
    const parsed = assistSseDoneSchema.parse({ reply: '你好' });
    expect(parsed.suggestions).toBeUndefined();
  });

  it('accepts up to three suggestion chips', () => {
    const parsed = assistSseDoneSchema.parse({
      reply: '大意是…',
      suggestions: ['orbit 在文中指什么？', '用更简单的英语说这段', '这段时态是什么？'],
    });
    expect(parsed.suggestions).toHaveLength(3);
  });

  it('accepts optional conversationId', () => {
    const parsed = assistSseDoneSchema.parse({ reply: '你好', conversationId: 'conv_1' });
    expect(parsed.conversationId).toBe('conv_1');
  });

  it('rejects empty suggestions array', () => {
    const result = assistSseDoneSchema.safeParse({ reply: 'x', suggestions: [] });
    expect(result.success).toBe(false);
  });
});
