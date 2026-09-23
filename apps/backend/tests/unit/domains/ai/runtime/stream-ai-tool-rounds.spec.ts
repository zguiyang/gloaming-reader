import { AIMessageChunk } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { streamAi } from '@/domains/ai/runtime/service';
import { HTTP_STATUS } from '@/shared/constants';
import { ERROR_CODES } from '@/shared/errors/codes';

const mocks = vi.hoisted(() => ({
  recordInvocation: vi.fn(async () => undefined),
  resolveModelRowId: vi.fn(async () => 'model-row-test'),
  createLlmClient: vi.fn(),
  resolveLlmByModelRowId: vi.fn(async () => ({
    modelRowId: 'model-row-test',
    providerId: 'provider-test',
    modelId: 'model-test',
    label: 'Test model',
    baseUrl: 'https://llm.test',
  })),
}));

vi.mock('@/domains/ai/invocations/log', () => ({
  recordInvocation: mocks.recordInvocation,
}));

vi.mock('@/domains/ai/runtime/purpose-model', () => ({
  resolveModelRowId: mocks.resolveModelRowId,
}));

vi.mock('@/infra/llm', () => ({
  createLlmClient: (...args: unknown[]) => mocks.createLlmClient(...args),
  resolveLlmByModelRowId: (...args: unknown[]) => mocks.resolveLlmByModelRowId(...args),
}));

type StreamFactory = () => AsyncGenerator<AIMessageChunk>;

function chunkStream(content: string, toolCalls?: AIMessageChunk['tool_calls']): StreamFactory {
  return async function* streamFactory() {
    yield new AIMessageChunk({
      content,
      tool_calls: toolCalls,
      usage_metadata: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
  };
}

function emptyStream(): StreamFactory {
  return async function* streamFactory() {
    yield new AIMessageChunk({
      content: '',
      usage_metadata: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
    });
  };
}

function setupMockChat(boundStreams: StreamFactory[], unboundStreams: StreamFactory[] = []) {
  let boundIndex = 0;
  let unboundIndex = 0;

  const unboundStream = vi.fn(async () => {
    const factory = unboundStreams[unboundIndex];
    unboundIndex += 1;
    if (!factory) {
      throw new Error(`Unexpected unbound stream call #${unboundIndex}`);
    }
    return factory();
  });

  mocks.createLlmClient.mockReturnValue({
    bindTools: () => ({
      stream: async () => {
        const factory = boundStreams[boundIndex];
        boundIndex += 1;
        if (!factory) {
          throw new Error(`Unexpected bound stream call #${boundIndex}`);
        }
        return factory();
      },
    }),
    stream: unboundStream,
  });

  return { unboundStream };
}

const testTool: StructuredToolInterface = {
  name: 'get_part_slice',
  invoke: vi.fn(async () => 'slice text'),
  lc_namespace: ['test'],
  call: vi.fn(),
  schema: {},
};

const baseOptions = {
  source: 'unit-test',
  messages: [{ role: 'user' as const, content: 'Summarize this part' }],
};

async function collectStreamEvents(options: Parameters<typeof streamAi>[0]) {
  const events = [];
  for await (const event of streamAi(options)) {
    events.push(event);
  }
  return events;
}

beforeEach(() => {
  mocks.recordInvocation.mockClear();
  mocks.resolveModelRowId.mockClear();
  mocks.createLlmClient.mockReset();
  mocks.resolveLlmByModelRowId.mockClear();
  vi.mocked(testTool.invoke).mockClear();
});

describe('streamAi tool rounds', () => {
  it('streams final answer after tool rounds when the last bound turn has text', async () => {
    const { unboundStream } = setupMockChat([
      chunkStream('', [{ id: 'call-1', name: 'get_part_slice', args: {}, type: 'tool_call' as const }]),
      chunkStream('Part gist in Chinese.'),
    ]);

    const events = await collectStreamEvents({
      ...baseOptions,
      tools: [testTool],
    });

    expect(events).toEqual([
      { type: 'delta', text: 'Part gist in Chinese.' },
      {
        type: 'done',
        content: 'Part gist in Chinese.',
        model: { rowId: 'model-row-test', label: 'Test model', modelId: 'model-test' },
        usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
      },
    ]);
    expect(testTool.invoke).toHaveBeenCalledTimes(1);
    expect(unboundStream).not.toHaveBeenCalled();
    expect(mocks.recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', requestSummary: expect.objectContaining({ toolRoundCount: 1 }) }),
    );
  });

  it('runs an unbound follow-up stream when max tool rounds end with empty final text', async () => {
    const { unboundStream } = setupMockChat(
      [chunkStream('', [{ id: 'call-1', name: 'get_part_slice', args: {}, type: 'tool_call' as const }])],
      [chunkStream('Answer after tools.')],
    );

    const events = await collectStreamEvents({
      ...baseOptions,
      tools: [testTool],
      maxToolRounds: 1,
    });

    expect(events.map((e) => e.type)).toEqual(['delta', 'done']);
    expect(events.at(-1)).toMatchObject({ type: 'done', content: 'Answer after tools.' });
    expect(unboundStream).toHaveBeenCalledTimes(1);
  });

  it('streams normally without tools', async () => {
    setupMockChat([], [chunkStream('Plain assist reply.')]);

    const events = await collectStreamEvents(baseOptions);

    expect(events).toEqual([
      { type: 'delta', text: 'Plain assist reply.' },
      {
        type: 'done',
        content: 'Plain assist reply.',
        model: { rowId: 'model-row-test', label: 'Test model', modelId: 'model-test' },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    ]);
  });

  it('fails when no displayable text is produced and no tool rounds ran', async () => {
    setupMockChat([], [emptyStream()]);

    await expect(collectStreamEvents(baseOptions)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
      code: ERROR_CODES.AI.UNAVAILABLE,
    });
    expect(mocks.recordInvocation).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure' }));
  });

  it('fails when tool rounds ran but follow-up stream is still empty', async () => {
    setupMockChat(
      [chunkStream('', [{ id: 'call-1', name: 'get_part_slice', args: {}, type: 'tool_call' as const }])],
      [emptyStream()],
    );

    await expect(
      collectStreamEvents({
        ...baseOptions,
        tools: [testTool],
        maxToolRounds: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
      code: ERROR_CODES.AI.UNAVAILABLE,
    });

    expect(mocks.recordInvocation).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure' }));
  });
});
