// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

import type { ReaderAudioManifest, ReaderAudioSegment } from '@gloaming/shared/reader';

import {
  READER_AUDIO_MANIFEST_STALE_CODE,
  ReaderAudioController,
  type ReaderAudioControllerState,
  resolveVisibleParagraphAnchor,
} from '@/features/reader/audio/reader-audio-controller';
import { ApiRequestError } from '@/lib/api-request';

type TestRole = 'us' | 'uk';

/** Minimal HTMLAudioElement stand-in — records calls, dispatches lifecycle events manually. */
class FakeAudio {
  src = '';
  playbackRate = 1;
  currentTime = 0;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  private readonly listeners = new Map<string, Set<() => void>>();

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
}

/** Two paragraphs; per role, 4 segments (two chunks each) — indexes 0,1 → p0, 2,3 → p1. */
function buildManifest(role: TestRole, count = 4, generation = ''): ReaderAudioManifest {
  return {
    role,
    ttsConfigured: true,
    configFingerprint: `fp-${role}`,
    segments: Array.from({ length: count }, (_, index) => ({
      index,
      key: `p${Math.floor(index / 2)}:c${index % 2}`,
      segmentHash: generation ? `${generation}-${role}-hash-${index}` : `${role}-hash-${index}`,
      paragraphAnchor: String(Math.floor(index / 2)),
      paragraphTextOffset: (index % 2) * 10,
      textLength: 10,
    })),
  };
}

function buildSegmentPayload(role: TestRole, index: number, generation = ''): ReaderAudioSegment {
  const meta = buildManifest(role, 4, generation).segments[index]!;
  return {
    index,
    role,
    voice: role === 'us' ? 'en-US-voice' : 'en-GB-voice',
    mimeType: 'audio/mpeg',
    durationMs: 1000,
    wordTimings: [{ text: `w${index}`, audioOffsetMs: 0, durationMs: 100, textOffset: 0 }],
    paragraphAnchor: meta.paragraphAnchor,
    paragraphTextOffset: meta.paragraphTextOffset,
    segmentHash: meta.segmentHash,
    audioUrl: generation ? `/audio/${generation}/${role}/${index}` : `/audio/${role}/${index}`,
  };
}

function stubRect(element: Element, top: number, bottom: number): void {
  element.getBoundingClientRect = () =>
    ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top }) as DOMRect;
}

/** Reading container whose topmost visible paragraph is `anchorParagraph` (0 or 1). */
function renderContainer(anchorParagraph: 0 | 1): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="reading-body">
      <p data-p="0">Paragraph one.</p>
      <p data-p="1">Paragraph two.</p>
    </div>
  `;
  document.body.appendChild(container);
  const paragraphs = container.querySelectorAll('[data-p]');
  if (anchorParagraph === 0) {
    stubRect(paragraphs[0]!, 0, 900);
    stubRect(paragraphs[1]!, 900, 1200);
  } else {
    // Scrolled into the chapter: paragraph 0 is fully above the viewport.
    stubRect(paragraphs[0]!, -400, -50);
    stubRect(paragraphs[1]!, 100, 900);
  }
  return container;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** N paragraphs with explicit viewport rects (viewport height 768 in tests). */
function renderParagraphs(rects: Array<{ top: number; bottom: number }>): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = `<div class="reading-body">${rects
    .map((_, index) => `<p data-p="${index}">Paragraph ${index}.</p>`)
    .join('')}</div>`;
  document.body.appendChild(container);
  container.querySelectorAll('[data-p]').forEach((element, index) => {
    stubRect(element, rects[index]!.top, rects[index]!.bottom);
  });
  return container;
}

function createHarness(overrides?: {
  fetchManifest?: ReturnType<typeof vi.fn>;
  fetchSegment?: ReturnType<typeof vi.fn>;
}) {
  const states: ReaderAudioControllerState[] = [];
  const audio = new FakeAudio();
  const fetchManifest =
    overrides?.fetchManifest ?? vi.fn(async (_partId: string, role: TestRole) => buildManifest(role));
  const fetchSegment =
    overrides?.fetchSegment ??
    vi.fn(async (_partId: string, role: TestRole, index: number) => buildSegmentPayload(role, index));
  const onUnavailable = vi.fn();
  const onSegmentFailed = vi.fn();
  const controller = new ReaderAudioController({
    fetchManifest,
    fetchSegment,
    createAudio: () => audio as unknown as HTMLAudioElement,
    onStateChange: (state) => states.push(state),
    onUnavailable,
    onSegmentFailed,
  });
  controller.setContext({ partId: 'part-1', ttsConfigured: true });
  return { controller, audio, fetchManifest, fetchSegment, onUnavailable, onSegmentFailed, states };
}

describe('ReaderAudioController', () => {
  it('starts from the visible paragraph and plays its first segment', async () => {
    const harness = createHarness();
    const container = renderContainer(1);

    await harness.controller.startFromVisibleParagraph(container);

    expect(harness.fetchManifest).toHaveBeenCalledTimes(1);
    expect(harness.fetchManifest.mock.calls[0]).toEqual(['part-1', 'us', expect.anything()]);
    // Paragraph 1's first segment is index 2 — requested with its expectedHash.
    expect(harness.fetchSegment.mock.calls[0]!.slice(0, 4)).toEqual(['part-1', 'us', 2, 'us-hash-2']);
    expect(harness.audio.src).toBe('/audio/us/2');
    expect(harness.controller.getState()).toMatchObject({
      status: 'playing',
      role: 'us',
      currentIndex: 2,
      segment: { paragraphAnchor: '1', paragraphTextOffset: 0, textLength: 10 },
    });
  });

  it('falls back to index 0 when no paragraph is visible in the manifest', async () => {
    const harness = createHarness();
    const container = document.createElement('div');
    document.body.appendChild(container);

    await harness.controller.startFromVisibleParagraph(container);

    expect(harness.fetchSegment.mock.calls[0]!.slice(0, 4)).toEqual(['part-1', 'us', 0, 'us-hash-0']);
  });

  it('advances on ended and plays the prefetched next segment without refetching', async () => {
    const harness = createHarness();
    const container = renderContainer(1);

    await harness.controller.startFromVisibleParagraph(container);
    await flush(); // next-1 prefetch for index 3
    expect(harness.fetchSegment.mock.calls.filter((call) => call[2] === 3)).toHaveLength(1);

    harness.audio.dispatch('ended');
    await flush();

    expect(harness.audio.src).toBe('/audio/us/3');
    expect(harness.controller.getState().status).toBe('playing');
    // Prefetched once, served from cache on ended.
    expect(harness.fetchSegment.mock.calls.filter((call) => call[2] === 3)).toHaveLength(1);
  });

  it('stops at the last segment without requesting beyond the manifest', async () => {
    const harness = createHarness();
    const container = renderContainer(1);

    await harness.controller.startFromVisibleParagraph(container);
    await flush();
    harness.audio.dispatch('ended'); // → index 3 (last)
    await flush();
    expect(harness.controller.getState().status).toBe('playing');

    harness.audio.dispatch('ended'); // last segment finished
    await flush();

    expect(harness.controller.getState()).toMatchObject({ status: 'idle', currentIndex: -1, segment: null });
    expect(harness.fetchSegment.mock.calls.some((call) => call[2] === 4)).toBe(false);
  });

  it('stop aborts the in-flight segment request', async () => {
    const states: ReaderAudioControllerState[] = [];
    const audio = new FakeAudio();
    let capturedSignal: AbortSignal | undefined;
    const controller = new ReaderAudioController({
      fetchManifest: async (_partId, role) => buildManifest(role),
      fetchSegment: (_partId, _role, _index, _hash, init) => {
        capturedSignal = init?.signal;
        return new Promise(() => {
          /* never settles */
        });
      },
      createAudio: () => audio as unknown as HTMLAudioElement,
      onStateChange: (state) => states.push(state),
    });
    controller.setContext({ partId: 'part-1', ttsConfigured: true });
    const container = renderContainer(0);

    void controller.startFromVisibleParagraph(container);
    await flush();
    expect(capturedSignal).toBeDefined();
    expect(controller.getState().status).toBe('loading');

    controller.stop();

    expect(capturedSignal!.aborted).toBe(true);
    expect(controller.getState()).toMatchObject({ status: 'idle', currentIndex: -1 });
  });

  it('switching role aborts, clears the cache and replays from the current paragraph', async () => {
    const harness = createHarness();
    const container = renderContainer(1);

    await harness.controller.startFromVisibleParagraph(container);
    expect(harness.audio.src).toBe('/audio/us/2');

    const inFlightBefore = harness.fetchSegment.mock.calls.length;
    harness.controller.selectRole('uk');
    await flush();

    expect(harness.fetchManifest.mock.calls.at(-1)!.slice(0, 2)).toEqual(['part-1', 'uk']);
    const ukCallsForIndex2 = harness.fetchSegment.mock.calls.filter((call) => call[1] === 'uk' && call[2] === 2);
    expect(ukCallsForIndex2).toHaveLength(1);
    expect(ukCallsForIndex2[0]!.slice(0, 4)).toEqual(['part-1', 'uk', 2, 'uk-hash-2']);
    expect(harness.audio.src).toBe('/audio/uk/2');
    expect(harness.controller.getState()).toMatchObject({ status: 'playing', role: 'uk', currentIndex: 2 });
    expect(harness.fetchSegment.mock.calls.length).toBeGreaterThan(inFlightBefore);

    // Segment cache was dropped — switching back re-requests the US payload.
    harness.controller.selectRole('us');
    await flush();
    expect(harness.fetchSegment.mock.calls.filter((call) => call[1] === 'us' && call[2] === 2)).toHaveLength(2);
  });

  it('recovers from manifest_stale by refetching the manifest and replaying the segment', async () => {
    const harness = createHarness();
    const staleError = new ApiRequestError({
      message: 'stale',
      status: 409,
      code: READER_AUDIO_MANIFEST_STALE_CODE,
    });
    harness.fetchSegment.mockImplementation(async (_partId, role, index) => {
      if (harness.fetchSegment.mock.calls.length === 1) {
        throw staleError;
      }
      return buildSegmentPayload(role, index);
    });
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);

    expect(harness.fetchManifest).toHaveBeenCalledTimes(2);
    // First attempt rejected with 409, replay after the manifest refresh succeeded
    // (the third call is the silent next-1 prefetch).
    expect(harness.fetchSegment.mock.calls.filter((call) => call[2] === 0)).toHaveLength(2);
    expect(harness.controller.getState()).toMatchObject({ status: 'playing', currentIndex: 0 });
    expect(harness.audio.src).toBe('/audio/us/0');
    expect(harness.onSegmentFailed).not.toHaveBeenCalled();
  });

  it('never requests anything when TTS is not configured', async () => {
    const harness = createHarness();
    harness.controller.setContext({ partId: 'part-1', ttsConfigured: false });
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);

    expect(harness.onUnavailable).toHaveBeenCalledTimes(1);
    expect(harness.fetchManifest).not.toHaveBeenCalled();
    expect(harness.fetchSegment).not.toHaveBeenCalled();
    expect(harness.controller.getState().status).toBe('idle');
  });

  it('surfaces a segment failure and retries the current segment on toggle', async () => {
    const harness = createHarness();
    harness.fetchSegment.mockRejectedValueOnce(new ApiRequestError({ message: 'boom', status: 500, code: 'internal' }));
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);

    expect(harness.onSegmentFailed).toHaveBeenCalledTimes(1);
    expect(harness.controller.getState().status).toBe('error');

    harness.controller.toggle(container);
    await flush();

    expect(harness.controller.getState().status).toBe('playing');
    expect(harness.audio.src).toBe('/audio/us/0');
  });

  it('pauses and resumes without refetching the segment', async () => {
    const harness = createHarness();
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);
    expect(harness.audio.playCalls).toBe(1);

    harness.controller.toggle(container); // pause
    expect(harness.audio.pauseCalls).toBeGreaterThanOrEqual(1);
    expect(harness.controller.getState().status).toBe('paused');

    harness.controller.toggle(container); // resume
    await flush();

    expect(harness.controller.getState().status).toBe('playing');
    expect(harness.audio.playCalls).toBe(2);
    expect(harness.fetchSegment.mock.calls.filter((call) => call[2] === 0)).toHaveLength(1);
  });

  it('applies the playback rate to the audio element', async () => {
    const harness = createHarness();
    const container = renderContainer(0);

    harness.controller.setPlaybackRate(1.5);
    await harness.controller.startFromVisibleParagraph(container);

    expect(harness.audio.playbackRate).toBe(1.5);

    harness.controller.setPlaybackRate(2);
    expect(harness.audio.playbackRate).toBe(2);
  });

  it('destroy releases the audio element and stops event-driven advance', async () => {
    const harness = createHarness();
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);
    harness.controller.destroy();

    expect(harness.controller.getState()).toMatchObject({ status: 'idle', currentIndex: -1, segment: null });
    const callsBefore = harness.fetchSegment.mock.calls.length;
    harness.audio.dispatch('ended');
    await flush();
    expect(harness.fetchSegment.mock.calls.length).toBe(callsBefore);
  });

  it('clears the segment cache on manifest_stale and replays with the new hash, not the old payload', async () => {
    const staleError = new ApiRequestError({
      message: 'stale',
      status: 409,
      code: READER_AUDIO_MANIFEST_STALE_CODE,
    });
    const deferred = createDeferred<ReaderAudioSegment>();
    // First manifest generation uses `us-hash-*`, the refresh uses `v2-us-hash-*`.
    let generation = '';
    let hasServedStale = false;
    const fetchManifest = vi.fn(async (_partId: string, role: TestRole) => buildManifest(role, 4, generation));
    const harness = createHarness({ fetchManifest });
    harness.fetchSegment.mockImplementation(async (_partId, role, index) => {
      if (index === 2 && !hasServedStale) {
        hasServedStale = true;
        return deferred.promise; // in-flight request answered with manifest_stale below
      }
      return buildSegmentPayload(role, index, generation);
    });
    const container = renderContainer(0); // visible anchor "0"

    // Prime the cache with old-generation payloads (segments 0 and 1).
    await harness.controller.startFromVisibleParagraph(container);
    await flush();
    expect(harness.audio.src).toBe('/audio/us/0');

    // Advance into the cached segment 1; its next-1 prefetch for segment 2 hangs.
    harness.audio.dispatch('ended');
    await flush();
    expect(harness.audio.src).toBe('/audio/us/1');

    // Advance again — the load joins the in-flight segment 2 request, which
    // fails with manifest_stale; the manifest is refetched with new hashes.
    harness.audio.dispatch('ended');
    await flush();
    generation = 'v2';
    deferred.reject(staleError);
    await flush();

    expect(harness.fetchManifest).toHaveBeenCalledTimes(2);
    const index2Calls = harness.fetchSegment.mock.calls.filter((call) => call[2] === 2);
    expect(index2Calls).toHaveLength(2);
    expect(index2Calls[1]!.slice(0, 4)).toEqual(['part-1', 'us', 2, 'v2-us-hash-2']);
    expect(harness.audio.src).toBe('/audio/v2/us/2'); // refreshed payload, never an old-generation one
    expect(harness.onSegmentFailed).not.toHaveBeenCalled();

    // The stale cache was dropped: restarting from the visible paragraph
    // re-requests segment 0 with the new expectedHash instead of replaying
    // the old cached payload.
    await harness.controller.startFromVisibleParagraph(container);
    const index0Calls = harness.fetchSegment.mock.calls.filter((call) => call[2] === 0);
    expect(index0Calls).toHaveLength(2);
    expect(index0Calls[1]!.slice(0, 4)).toEqual(['part-1', 'us', 0, 'v2-us-hash-0']);
    expect(harness.audio.src).toBe('/audio/v2/us/0');
  });

  it('surfaces a reused failed in-flight prefetch as an error (not stuck loading) and retries', async () => {
    const harness = createHarness();
    const deferred = createDeferred<ReaderAudioSegment>();
    harness.fetchSegment.mockImplementation(async (_partId, role, index) => {
      if (index === 1) {
        return deferred.promise;
      }
      return buildSegmentPayload(role, index);
    });
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);
    await flush(); // next-1 prefetch for index 1 hangs in flight
    expect(harness.fetchSegment.mock.calls.filter((call) => call[2] === 1)).toHaveLength(1);

    harness.audio.dispatch('ended'); // advance joins the in-flight prefetch
    await flush();
    deferred.reject(new ApiRequestError({ message: 'boom', status: 500, code: 'internal' }));
    await flush();

    // A network/server failure on the reused request is an error, not an abort.
    expect(harness.controller.getState().status).toBe('error');
    expect(harness.onSegmentFailed).toHaveBeenCalledTimes(1);

    // Toggle retries the failed segment instead of staying stuck on loading.
    harness.fetchSegment.mockImplementation(async (_partId, role, index) => buildSegmentPayload(role, index));
    harness.controller.toggle(container);
    await flush();
    expect(harness.controller.getState()).toMatchObject({ status: 'playing', currentIndex: 1 });
    expect(harness.audio.src).toBe('/audio/us/1');
  });

  it('treats a stop-aborted reused request as aborted without reporting an error', async () => {
    const harness = createHarness();
    const deferred = createDeferred<ReaderAudioSegment>();
    harness.fetchSegment.mockImplementation(async (_partId, role, index) => {
      if (index === 1) {
        return deferred.promise;
      }
      return buildSegmentPayload(role, index);
    });
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);
    await flush();
    harness.audio.dispatch('ended'); // advance joins the in-flight prefetch
    await flush();

    harness.controller.stop();
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    deferred.reject(abortError);
    await flush();

    expect(harness.controller.getState()).toMatchObject({ status: 'idle', currentIndex: -1, segment: null });
    expect(harness.onSegmentFailed).not.toHaveBeenCalled();
  });

  it('stops playback and drops cached manifests when TTS becomes unavailable', async () => {
    const harness = createHarness();
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);
    expect(harness.controller.getState().status).toBe('playing');
    const manifestCallsBefore = harness.fetchManifest.mock.calls.length;

    harness.controller.setContext({ partId: 'part-1', ttsConfigured: false });

    expect(harness.controller.getState()).toMatchObject({ status: 'idle', currentIndex: -1, segment: null });
    expect(harness.audio.pauseCalls).toBeGreaterThanOrEqual(1);

    // The cached manifest was dropped: re-enabling refetches instead of reusing it.
    harness.controller.setContext({ partId: 'part-1', ttsConfigured: true });
    await harness.controller.startFromVisibleParagraph(container);
    expect(harness.fetchManifest.mock.calls.length).toBe(manifestCallsBefore + 1);
    expect(harness.controller.getState().status).toBe('playing');
  });

  it('starts at the chapter opening (paragraph 0) when the topmost visible is a short title', async () => {
    // One segment per paragraph — unlike buildManifest, which chunks two per paragraph.
    const manifest: ReaderAudioManifest = {
      role: 'us',
      ttsConfigured: true,
      configFingerprint: 'fp-us',
      segments: [
        {
          index: 0,
          key: '0:c0',
          segmentHash: 'us-hash-0',
          paragraphAnchor: '0',
          paragraphTextOffset: 0,
          textLength: 10,
        },
        {
          index: 1,
          key: '1:c0',
          segmentHash: 'us-hash-1',
          paragraphAnchor: '1',
          paragraphTextOffset: 0,
          textLength: 10,
        },
      ],
    };
    const harness = createHarness({
      fetchManifest: vi.fn(async () => manifest),
      fetchSegment: vi.fn(async (_partId, _role, index) => ({
        ...buildSegmentPayload('us', index),
        paragraphAnchor: String(index),
      })),
    });
    // Chapter start after switching chapters: p0 is a short title (32–76), the
    // body p1 starts at 92. The viewport center lands in p1, but the topmost
    // visible paragraph is p0 — playback must open the chapter, not its second paragraph.
    const container = renderParagraphs([
      { top: 32, bottom: 76 },
      { top: 92, bottom: 560 },
    ]);

    await harness.controller.startFromVisibleParagraph(container);

    expect(harness.fetchSegment.mock.calls[0]!.slice(0, 4)).toEqual(['part-1', 'us', 0, 'us-hash-0']);
    expect(harness.audio.src).toBe('/audio/us/0');
    expect(harness.controller.getState()).toMatchObject({
      status: 'playing',
      currentIndex: 0,
      segment: { paragraphAnchor: '0' },
    });
  });

  it('starts from the next playable paragraph when the visible one has no audio segment', async () => {
    // Paragraph 1 is image-only (no segments); playable paragraphs are 0 and 2.
    const manifest: ReaderAudioManifest = {
      role: 'us',
      ttsConfigured: true,
      configFingerprint: 'fp-us',
      segments: [
        {
          index: 0,
          key: '0:c0',
          segmentHash: 'us-hash-0',
          paragraphAnchor: '0',
          paragraphTextOffset: 0,
          textLength: 10,
        },
        {
          index: 1,
          key: '2:c0',
          segmentHash: 'us-hash-1',
          paragraphAnchor: '2',
          paragraphTextOffset: 0,
          textLength: 10,
        },
      ],
    };
    const harness = createHarness({
      fetchManifest: vi.fn(async () => manifest),
      fetchSegment: vi.fn(async (_partId, _role, index) => ({
        ...buildSegmentPayload('us', index),
        paragraphAnchor: index === 1 ? '2' : '0',
      })),
    });
    // Topmost visible paragraph is 1 (no audio segment); paragraph 0 is above the fold.
    const container = renderParagraphs([
      { top: -200, bottom: -50 },
      { top: 100, bottom: 700 },
      { top: 700, bottom: 900 },
    ]);

    await harness.controller.startFromVisibleParagraph(container);

    // Anchor "1" has no segment → first segment whose paragraph is at-or-after it.
    expect(harness.fetchSegment.mock.calls[0]!.slice(0, 4)).toEqual(['part-1', 'us', 1, 'us-hash-1']);
    expect(harness.audio.src).toBe('/audio/us/1');
    expect(harness.controller.getState()).toMatchObject({
      status: 'playing',
      currentIndex: 1,
      segment: { paragraphAnchor: '2' },
    });
  });

  it('falls back to the last playable segment when the visible paragraph is past the end', async () => {
    // Playable paragraphs are 0 and 1; paragraph 2 is a trailing image.
    const manifest: ReaderAudioManifest = {
      role: 'us',
      ttsConfigured: true,
      configFingerprint: 'fp-us',
      segments: [
        {
          index: 0,
          key: '0:c0',
          segmentHash: 'us-hash-0',
          paragraphAnchor: '0',
          paragraphTextOffset: 0,
          textLength: 10,
        },
        {
          index: 1,
          key: '1:c0',
          segmentHash: 'us-hash-1',
          paragraphAnchor: '1',
          paragraphTextOffset: 0,
          textLength: 10,
        },
      ],
    };
    const harness = createHarness({
      fetchManifest: vi.fn(async () => manifest),
      fetchSegment: vi.fn(async (_partId, _role, index) => ({
        ...buildSegmentPayload('us', index),
        paragraphAnchor: String(index),
      })),
    });
    // Topmost visible paragraph is 2 (a trailing image past every segment).
    const container = renderParagraphs([
      { top: -300, bottom: -200 },
      { top: -100, bottom: -50 },
      { top: 300, bottom: 700 },
    ]);

    await harness.controller.startFromVisibleParagraph(container);

    // Nothing follows the visible paragraph → nearest playable is the last segment.
    expect(harness.fetchSegment.mock.calls[0]!.slice(0, 4)).toEqual(['part-1', 'us', 1, 'us-hash-1']);
    expect(harness.audio.src).toBe('/audio/us/1');
  });
});

describe('resolveVisibleParagraphAnchor', () => {
  it('returns the topmost visible paragraph, not the one containing the viewport center', () => {
    // Chapter opening: short title p0, body p1 below. Center = 384 lands in
    // p1, but the anchor must be the chapter's first paragraph.
    const container = renderParagraphs([
      { top: 32, bottom: 76 },
      { top: 92, bottom: 560 },
    ]);
    expect(resolveVisibleParagraphAnchor(container, 768)).toBe('0');
  });

  it('returns the first paragraph whose top is visible when scrolled mid-chapter', () => {
    const container = renderParagraphs([
      { top: -500, bottom: -100 }, // fully above the viewport
      { top: -40, bottom: 400 }, // only its top sliver shows
      { top: 500, bottom: 900 }, // below the fold
    ]);
    expect(resolveVisibleParagraphAnchor(container, 768)).toBe('1');
  });

  it('falls back to the last paragraph above the fold when all content is scrolled past', () => {
    const container = renderParagraphs([
      { top: -800, bottom: -400 },
      { top: -300, bottom: -50 },
    ]);
    expect(resolveVisibleParagraphAnchor(container, 768)).toBe('1');
  });

  it('returns the first paragraph when all content is below the fold', () => {
    const container = renderParagraphs([
      { top: 1000, bottom: 1200 },
      { top: 1300, bottom: 1500 },
    ]);
    expect(resolveVisibleParagraphAnchor(container, 768)).toBe('0');
  });

  it('returns null when the container has no paragraphs', () => {
    const container = document.createElement('div');
    expect(resolveVisibleParagraphAnchor(container, 768)).toBeNull();
  });
});
