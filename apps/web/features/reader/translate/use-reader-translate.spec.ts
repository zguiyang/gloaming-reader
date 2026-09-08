import { describe, expect, it, vi } from 'vitest';

import { TRANSLATE_SSE_EVENT } from '@gloaming/shared/translate';

import { streamTranslatePart } from '@/features/reader/translate/reader-translate-api';

describe('streamTranslatePart', () => {
  it('parses meta, title, sentence, and done events properly', async () => {
    const sseChunks = [
      `event: ${TRANSLATE_SSE_EVENT.meta}\ndata: {"contentHash":"hash1","titleEn":"Title En","sentences":[{"index":0,"paragraphIndex":0,"en":"Hello."},{"index":1,"paragraphIndex":1,"en":"World."}]}\n\n`,
      `event: ${TRANSLATE_SSE_EVENT.title}\ndata: {"zh":"标题"}\n\n`,
      `event: ${TRANSLATE_SSE_EVENT.sentence}\ndata: {"index":0,"zh":"你好。"}\n\n`,
      `event: ${TRANSLATE_SSE_EVENT.sentence}\ndata: {"index":1,"zh":"世界。"}\n\n`,
      `event: ${TRANSLATE_SSE_EVENT.done}\ndata: {"contentHash":"hash1","cached":false}\n\n`,
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    global.fetch = mockFetch;

    const metas: unknown[] = [];
    const titles: unknown[] = [];
    const sentences: unknown[] = [];

    const result = await streamTranslatePart(
      { partId: 'part-1' },
      {
        onMeta: (meta) => metas.push(meta),
        onTitle: (title) => titles.push(title),
        onSentence: (sentence) => sentences.push(sentence),
      },
    );

    expect(result).toEqual({ contentHash: 'hash1', cached: false });
    expect(metas).toEqual([
      {
        contentHash: 'hash1',
        titleEn: 'Title En',
        sentences: [
          { index: 0, paragraphIndex: 0, en: 'Hello.' },
          { index: 1, paragraphIndex: 1, en: 'World.' },
        ],
      },
    ]);
    expect(titles).toEqual([{ zh: '标题' }]);
    expect(sentences).toEqual([
      { index: 0, zh: '你好。' },
      { index: 1, zh: '世界。' },
    ]);
  });

  it('throws when server returns error event', async () => {
    const sseChunks = [`event: ${TRANSLATE_SSE_EVENT.error}\ndata: {"error":"AI model unavailable"}\n\n`];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    global.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    await expect(streamTranslatePart({ partId: 'part-1' })).rejects.toThrow('AI model unavailable');
  });
});
