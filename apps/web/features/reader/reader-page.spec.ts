// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReaderApiModule from '@/features/reader/reader-api';
import { ApiRequestError } from '@/lib/api-request';
import { LocaleProvider } from '@/lib/locale-context';

import { ReaderPage } from './reader-page';

const mocks = vi.hoisted(() => ({
  openLogin: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  getReaderAudioManifest: vi.fn(),
  getReaderAudioSegment: vi.fn(),
  routerReplace: vi.fn(),
  routerPush: vi.fn(),
}));

const fixtures = vi.hoisted(() => {
  const partData = {
    work: { id: 'w1', title: 'Work', coverAssetId: null },
    part: {
      id: 'p1',
      workId: 'w1',
      sortOrder: 0,
      kind: 'chapter' as const,
      title: 'Chapter 1',
      body: '<p data-p="0">Paragraph one.</p><p data-p="1">Paragraph two.</p>',
    },
    ttsConfigured: true,
  };

  const partsData = {
    work: { id: 'w1', title: 'Work', description: null, coverAssetId: null, publishedAt: null },
    parts: [
      {
        id: 'p1',
        workId: 'w1',
        sortOrder: 0,
        kind: 'chapter' as const,
        title: 'Chapter 1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        wordCount: 2,
        estimatedMinutes: 1,
      },
    ],
  };

  function buildManifest(role: 'us' | 'uk') {
    return {
      role,
      ttsConfigured: true,
      configFingerprint: `fp-${role}`,
      segments: [
        {
          index: 0,
          key: 'p0:c0',
          segmentHash: `${role}-hash-0`,
          paragraphAnchor: '0',
          paragraphTextOffset: 0,
          textLength: 13,
        },
        {
          index: 1,
          key: 'p1:c0',
          segmentHash: `${role}-hash-1`,
          paragraphAnchor: '1',
          paragraphTextOffset: 0,
          textLength: 13,
        },
      ],
    };
  }

  function buildSegmentPayload(role: 'us' | 'uk', index: number) {
    const meta = buildManifest(role).segments[index]!;
    return {
      index,
      role,
      voice: role === 'us' ? 'en-US-voice' : 'en-GB-voice',
      mimeType: 'audio/mpeg',
      durationMs: 1000,
      wordTimings: [{ text: 'Paragraph', audioOffsetMs: 0, durationMs: 100, textOffset: 0 }],
      paragraphAnchor: meta.paragraphAnchor,
      paragraphTextOffset: meta.paragraphTextOffset,
      segmentHash: meta.segmentHash,
      audioUrl: `/audio/${role}/${index}`,
    };
  }

  return { partData, partsData, buildManifest, buildSegmentPayload };
});

const { partData, partsData, buildManifest, buildSegmentPayload } = fixtures;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.routerReplace, push: mocks.routerPush, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/auth', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false, error: null }) },
}));
vi.mock('@/features/auth', () => ({ useAuthDialog: () => ({ openLogin: mocks.openLogin }) }));
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, info: mocks.toastInfo },
}));
vi.mock('@/features/reader/reader-heartbeat', () => ({ useReadingHeartbeat: () => {} }));
vi.mock('@/features/reader/assist/use-reader-assist', () => ({
  useReaderAssist: () => ({
    aiMode: 'closed',
    inlineSession: null,
    isInlineStreaming: false,
    messages: [],
    suggestions: [],
    conversations: [],
    activeConversationId: null,
    isHistoryLoading: false,
    historyError: null,
    isDrawerSending: false,
    error: null,
    activeQuote: null,
    openDrawer: vi.fn(),
    closeAiSurface: vi.fn(),
    resetInline: vi.fn(),
    runInlineAssist: vi.fn(),
    openInlineQuestion: vi.fn(),
    openInlineConversationInDrawer: vi.fn(),
    refetchHistory: vi.fn(),
    sendDrawerMessage: vi.fn(),
    clearActiveQuote: vi.fn(),
    restoreConversation: vi.fn(),
    startNewDrawerConversation: vi.fn(),
  }),
}));
vi.mock('@/features/reader/translate/use-reader-translate', () => ({
  useReaderTranslate: () => ({
    isActive: false,
    isLoading: false,
    isStreaming: false,
    error: null,
    sentences: [],
    translationsByIndex: {},
    titleZh: null,
    toggleBilingual: vi.fn(),
  }),
}));
vi.mock('@/features/reader/dictionary/reader-dictionary-api', () => ({
  useDictionaryLookupQuery: () => ({ data: undefined, isPending: false, isError: false, refetch: vi.fn() }),
}));
const stubs = vi.hoisted(() => ({
  nullComponent: () => null,
}));

vi.mock('@/features/reader/assist/reader-ai-drawer', () => ({ ReaderAiDrawer: stubs.nullComponent }));
vi.mock('@/features/reader/assist/reader-ai-inline', () => ({ ReaderAiInline: stubs.nullComponent }));

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  playbackRate = 1;
  currentTime = 0;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor() {
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
  }

  load(): void {}

  removeAttribute(): void {}

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }

  get current(): FakeAudio {
    return this;
  }
}

vi.mock('@/features/reader/reader-api', async (importOriginal) => {
  const actual = await importOriginal<typeof ReaderApiModule>();
  return {
    ...actual,
    getReaderAudioManifest: mocks.getReaderAudioManifest,
    getReaderAudioSegment: mocks.getReaderAudioSegment,
    useReaderPartsQuery: () => ({ data: partsData, isPending: false, isError: false, refetch: vi.fn() }),
    useReaderPartQuery: () => ({ data: partData, isPending: false, isError: false, refetch: vi.fn() }),
    useReadingStateQuery: () => ({
      data: null,
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    }),
    useReaderStateMutation: () => ({
      mutateAsync: async () => ({
        status: 'in_progress',
        currentPartId: 'p1',
        completedThroughSortOrder: -1,
        anchor: null,
        revision: 1,
        progressRatio: 10,
        totalPartCount: 1,
        lastReadAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
      }),
    }),
  };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio);
  partData.ttsConfigured = true;
  mocks.getReaderAudioManifest.mockImplementation(async (_partId: string, role: 'us' | 'uk') => buildManifest(role));
  mocks.getReaderAudioSegment.mockImplementation(async (_partId: string, role: 'us' | 'uk', index: number) =>
    buildSegmentPayload(role, index),
  );
});

const renderedRoots: Array<() => void> = [];

afterEach(() => {
  while (renderedRoots.length) renderedRoots.pop()?.();
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function withProviders(node: ReactElement, client: QueryClient): ReactElement {
  return createElement(
    QueryClientProvider,
    { client },
    // eslint-disable-next-line react/no-children-prop
    createElement(LocaleProvider, { locale: 'en-US', children: node }),
  );
}

async function renderReaderPage() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(withProviders(createElement(ReaderPage, { workId: 'w1' }), client)));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  let isCleaned = false;
  const cleanup = () => {
    if (isCleaned) return;
    isCleaned = true;
    act(() => root.unmount());
    container.remove();
  };
  renderedRoots.push(cleanup);
  return { container, cleanup };
}

function clickButton(container: HTMLElement, ariaLabel: string): HTMLElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (element) => element.getAttribute('aria-label') === ariaLabel,
  );
  if (!button) {
    throw new Error(`No button with aria-label "${ariaLabel}"`);
  }
  act(() => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  return button;
}

async function flushMicrotasks() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe('ReaderPage lazy audio', () => {
  it('toasts "not configured" without any audio request when TTS is unset', async () => {
    partData.ttsConfigured = false;
    const { container } = await renderReaderPage();

    clickButton(container, 'Listen');
    await flushMicrotasks();

    expect(mocks.toastError).toHaveBeenCalledWith('Read-aloud is not configured yet');
    expect(mocks.getReaderAudioManifest).not.toHaveBeenCalled();
    expect(mocks.getReaderAudioSegment).not.toHaveBeenCalled();
  });

  it('plays the visible paragraph segment and toggles pause/resume', async () => {
    const { container } = await renderReaderPage();

    clickButton(container, 'Listen');
    await flushMicrotasks();

    // No viewport rects in happy-dom → last paragraph is chosen → its first segment.
    expect(mocks.getReaderAudioManifest).toHaveBeenCalledWith('p1', 'us', expect.anything());
    expect(mocks.getReaderAudioSegment.mock.calls[0]!.slice(0, 4)).toEqual(['p1', 'us', 1, 'us-hash-1']);
    const audio = FakeAudio.instances.at(-1)!;
    expect(audio.src).toBe('/audio/us/1');
    expect(audio.playCalls).toBe(1);

    // Mini player shows the pause control while playing.
    clickButton(container, 'Pause');
    expect(audio.pauseCalls).toBe(1);

    clickButton(container, 'Play');
    await flushMicrotasks();
    expect(audio.playCalls).toBe(2);
    expect(mocks.getReaderAudioSegment.mock.calls.filter((call) => call[2] === 1)).toHaveLength(1);
  });

  it('switches voice role through the mini player accent control', async () => {
    const { container } = await renderReaderPage();

    clickButton(container, 'Listen');
    await flushMicrotasks();
    clickButton(container, 'UK accent');
    await flushMicrotasks();

    expect(mocks.getReaderAudioManifest).toHaveBeenCalledWith('p1', 'uk', expect.anything());
    expect(mocks.getReaderAudioSegment.mock.calls.some((call) => call[1] === 'uk' && call[2] === 1)).toBe(true);
    const audio = FakeAudio.instances.at(-1)!;
    expect(audio.src).toBe('/audio/uk/1');
  });

  it('toasts a segment failure and retries the current segment from the play button', async () => {
    const { container } = await renderReaderPage();
    mocks.getReaderAudioSegment.mockRejectedValueOnce(
      new ApiRequestError({ message: 'boom', status: 500, code: 'internal' }),
    );

    clickButton(container, 'Listen');
    await flushMicrotasks();

    expect(mocks.toastError).toHaveBeenCalledWith("Couldn't play this segment. Try again.");
    // Error state keeps the mini player open with a retry affordance, and the
    // chrome headphones toggle stays pressed so both affordances agree.
    const headphones = Array.from(container.querySelectorAll('button')).find(
      (element) => element.getAttribute('aria-label') === 'Listen',
    );
    expect(headphones?.getAttribute('aria-pressed')).toBe('true');
    clickButton(container, 'Retry');
    await flushMicrotasks();

    const audio = FakeAudio.instances.at(-1)!;
    expect(audio.src).toBe('/audio/us/1');
    expect(audio.playCalls).toBe(1);
    expect(mocks.getReaderAudioSegment.mock.calls.filter((call) => call[2] === 1)).toHaveLength(2);
  });

  it('stops playback when the last segment ends, without requesting more', async () => {
    const { container } = await renderReaderPage();

    clickButton(container, 'Listen');
    await flushMicrotasks();
    const audio = FakeAudio.instances.at(-1)!;

    // Paragraph 1's segment is the last one — ended stops instead of advancing.
    act(() => audio.dispatch('ended'));
    await flushMicrotasks();

    expect(audio.pauseCalls).toBeGreaterThanOrEqual(1);
    expect(mocks.getReaderAudioSegment.mock.calls.some((call) => call[2] === 2)).toBe(false);
    // Mini player (the fixed overlay) collapses back to idle.
    expect(container.querySelector('[data-reader-ui].fixed')).toBeNull();
  });
});
