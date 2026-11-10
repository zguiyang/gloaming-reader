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
  const meta = buildManifest(role, 8, generation).segments[index]!;
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

/** Segment bytes stand-in carrying its source URL so blob URLs stay deterministic. */
function audioBytesBlob(url: string): Blob {
  const blob = new Blob([`audio-bytes:${url}`], { type: 'audio/mpeg' });
  (blob as Blob & { sourceUrl?: string }).sourceUrl = url;
  return blob;
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
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
  fetchAudioBytes?: ReturnType<typeof vi.fn>;
}) {
  const states: ReaderAudioControllerState[] = [];
  const audio = new FakeAudio();
  const fetchManifest =
    overrides?.fetchManifest ?? vi.fn(async (_partId: string, role: TestRole) => buildManifest(role));
  const fetchSegment =
    overrides?.fetchSegment ??
    vi.fn(async (_partId: string, role: TestRole, index: number) => buildSegmentPayload(role, index));
  const fetchAudioBytes = overrides?.fetchAudioBytes ?? vi.fn(async (url: string) => audioBytesBlob(url));
  const createBlobUrl = vi.fn((blob: Blob) => `blob:${(blob as Blob & { sourceUrl?: string }).sourceUrl ?? 'unknown'}`);
  const revokeBlobUrl = vi.fn();
  const onUnavailable = vi.fn();
  const onSegmentFailed = vi.fn();
  const controller = new ReaderAudioController({
    fetchManifest,
    fetchSegment,
    fetchAudioBytes,
    createBlobUrl,
    revokeBlobUrl,
    createAudio: () => audio as unknown as HTMLAudioElement,
    onStateChange: (state) => states.push(state),
    onUnavailable,
    onSegmentFailed,
  });
  controller.setContext({ partId: 'part-1', ttsConfigured: true });
  return {
    controller,
    audio,
    fetchManifest,
    fetchSegment,
    fetchAudioBytes,
    createBlobUrl,
    revokeBlobUrl,
    onUnavailable,
    onSegmentFailed,
    states,
  };
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

  it('advances on ended from the look-ahead buffer without new metadata or byte requests', async () => {
    const harness = createHarness();
    const container = renderContainer(1);

    await harness.controller.startFromVisibleParagraph(container);
    await flush(); // look-ahead fill for index 3
    expect(harness.fetchSegment.mock.calls.filter((call) => call[2] === 3)).toHaveLength(1);
    expect(harness.fetchAudioBytes.mock.calls.map((call) => call[0])).toEqual(['/audio/us/3']);

    harness.audio.dispatch('ended');
    await flush();

    // Segment boundary plays straight from the in-memory blob — no network.
    expect(harness.audio.src).toBe('blob:/audio/us/3');
    expect(harness.controller.getState().status).toBe('playing');
    // Buffered once, served from memory on ended.
    expect(harness.fetchSegment.mock.calls.filter((call) => call[2] === 3)).toHaveLength(1);
    expect(harness.fetchAudioBytes.mock.calls).toHaveLength(1);
  });

  it('stops at the last segment without requesting beyond the manifest', async () => {
    const harness = createHarness();
    const container = renderContainer(1);

    await harness.controller.startFromVisibleParagraph(container);
    await flush();
    harness.audio.dispatch('ended'); // → index 3 (last, from the buffer)
    await flush();
    expect(harness.controller.getState().status).toBe('playing');
    expect(harness.audio.src).toBe('blob:/audio/us/3');

    harness.audio.dispatch('ended'); // last segment finished
    await flush();

    expect(harness.controller.getState()).toMatchObject({ status: 'idle', currentIndex: -1, segment: null });
    expect(harness.fetchSegment.mock.calls.some((call) => call[2] === 4)).toBe(false);
    expect(harness.fetchAudioBytes.mock.calls.some((call) => String(call[0]).includes('/4'))).toBe(false);
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

  it('switching role aborts, clears the cache and replays from the chapter beginning (segment 0)', async () => {
    const harness = createHarness();
    const container = renderContainer(1);

    await harness.controller.startFromVisibleParagraph(container);
    expect(harness.audio.src).toBe('/audio/us/2');
    const usCallsBeforeSwitch = harness.fetchSegment.mock.calls.filter((call) => call[1] === 'us').length;
    // Segment 3 was prefetched in flight — the switch must abort it.
    const inflightUsIndex3 = harness.fetchSegment.mock.calls.find((call) => call[1] === 'us' && call[2] === 3);
    expect(inflightUsIndex3).toBeDefined();

    harness.controller.selectRole('uk');
    await flush();

    expect(harness.fetchManifest.mock.calls.at(-1)!.slice(0, 2)).toEqual(['part-1', 'uk']);
    const ukCalls = harness.fetchSegment.mock.calls.filter((call) => call[1] === 'uk');
    // Voice switch restarts from the chapter's first segment, not the current paragraph.
    expect(ukCalls[0]!.slice(0, 4)).toEqual(['part-1', 'uk', 0, 'uk-hash-0']);
    expect(harness.audio.src).toBe('/audio/uk/0');
    expect(harness.controller.getState()).toMatchObject({ status: 'playing', role: 'uk', currentIndex: 0 });
    expect(harness.fetchSegment.mock.calls.length).toBeGreaterThan(usCallsBeforeSwitch);

    // Segment cache was dropped — switching back re-requests the US payload
    // (initially fetched for the start at index 2, now again after the reset).
    harness.controller.selectRole('us');
    await flush();
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
    // Advance into the buffered segment 1; its next fill for segment 2 hangs.
    harness.audio.dispatch('ended');
    await flush();
    expect(harness.audio.src).toBe('blob:/audio/us/1');

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

describe('ReaderAudioController chapter-switch restart semantics', () => {
  /** One segment per paragraph — segment index equals its paragraph anchor. */
  function buildParagraphManifest(role: TestRole, count = 6): ReaderAudioManifest {
    return {
      role,
      ttsConfigured: true,
      configFingerprint: `fp-${role}`,
      segments: Array.from({ length: count }, (_, index) => ({
        index,
        key: `${index}:c0`,
        segmentHash: `${role}-hash-${index}`,
        paragraphAnchor: String(index),
        paragraphTextOffset: 0,
        textLength: 10,
      })),
    };
  }

  /** Mid-chapter reading position: paragraphs 0–2 scrolled past, paragraph 3 visible. */
  function renderMidChapter(): HTMLDivElement {
    return renderParagraphs([
      { top: -800, bottom: -600 },
      { top: -500, bottom: -300 },
      { top: -200, bottom: -50 },
      { top: 100, bottom: 700 },
    ]);
  }

  function createParagraphHarness() {
    return createHarness({
      fetchManifest: vi.fn(async (_partId: string, role: TestRole) => buildParagraphManifest(role)),
      fetchSegment: vi.fn(async (_partId: string, role: TestRole, index: number) => ({
        ...buildSegmentPayload(role, index),
        paragraphAnchor: String(index),
      })),
    });
  }

  it('first acquisition of a part (null → id) still starts from the visible paragraph (anchor 3 → segment 3)', async () => {
    const harness = createParagraphHarness(); // setContext(null → 'part-1') inside
    const container = renderMidChapter();

    await harness.controller.startFromVisibleParagraph(container);

    expect(harness.fetchSegment.mock.calls[0]!.slice(0, 4)).toEqual(['part-1', 'us', 3, 'us-hash-3']);
    expect(harness.controller.getState()).toMatchObject({ status: 'playing', currentIndex: 3 });
  });

  it('after a chapter switch while playing, the next play starts at segment 0 despite the visible paragraph', async () => {
    const harness = createParagraphHarness();
    const container = renderMidChapter();

    await harness.controller.startFromVisibleParagraph(container);
    expect(harness.controller.getState().currentIndex).toBe(3);

    harness.controller.setContext({ partId: 'part-2', ttsConfigured: true });
    expect(harness.controller.getState()).toMatchObject({ status: 'idle', currentIndex: -1 });

    harness.controller.toggle(container);
    await flush();

    expect(harness.fetchManifest.mock.calls.at(-1)!.slice(0, 2)).toEqual(['part-2', 'us']);
    const part2Calls = harness.fetchSegment.mock.calls.filter((call) => call[0] === 'part-2');
    expect(part2Calls[0]!.slice(0, 4)).toEqual(['part-2', 'us', 0, 'us-hash-0']);
    expect(harness.audio.src).toBe('/audio/us/0');
    expect(harness.controller.getState()).toMatchObject({ status: 'playing', currentIndex: 0 });
  });

  it('a chapter switch observed through a transient null part (React Query key change) still starts at segment 0', async () => {
    const harness = createParagraphHarness();
    const container = renderMidChapter();

    await harness.controller.startFromVisibleParagraph(container);
    expect(harness.controller.getState().currentIndex).toBe(3);

    // The page drops to a loading state between parts: reader?.partId goes null
    // before the next part's data arrives.
    harness.controller.setContext({ partId: null, ttsConfigured: false });
    harness.controller.setContext({ partId: 'part-2', ttsConfigured: true });

    harness.controller.toggle(container);
    await flush();

    const part2Calls = harness.fetchSegment.mock.calls.filter((call) => call[0] === 'part-2');
    expect(part2Calls[0]!.slice(0, 4)).toEqual(['part-2', 'us', 0, 'us-hash-0']);
    expect(harness.controller.getState()).toMatchObject({ status: 'playing', currentIndex: 0 });
  });

  it('a chapter switch while idle also starts the next play at segment 0', async () => {
    const harness = createParagraphHarness(); // idle — never played in part-1
    const container = renderMidChapter();

    harness.controller.setContext({ partId: 'part-2', ttsConfigured: true });
    harness.controller.toggle(container);
    await flush();

    const part2Calls = harness.fetchSegment.mock.calls.filter((call) => call[0] === 'part-2');
    expect(part2Calls[0]!.slice(0, 4)).toEqual(['part-2', 'us', 0, 'us-hash-0']);
    expect(harness.controller.getState()).toMatchObject({ status: 'playing', currentIndex: 0 });
  });

  it('switching voice mid-playback aborts in-flight requests and restarts the new role at segment 0', async () => {
    const inflightSignals = new Map<string, AbortSignal | undefined>();
    const harness = createHarness({
      fetchManifest: vi.fn(async (_partId: string, role: TestRole) => buildParagraphManifest(role, 6)),
      fetchSegment: vi.fn(
        async (
          _partId: string,
          role: TestRole,
          index: number,
          _hash: string | undefined,
          init?: { signal?: AbortSignal },
        ) => {
          if (role === 'us' && index === 4) {
            inflightSignals.set('us-4', init?.signal);
            return new Promise<ReaderAudioSegment>(() => {
              /* never settles — simulates slow synthesis of the look-ahead fill */
            });
          }
          return { ...buildSegmentPayload(role, index), paragraphAnchor: String(index) };
        },
      ),
    });
    const container = renderMidChapter();

    await harness.controller.startFromVisibleParagraph(container); // segment 3
    await flush();
    expect(inflightSignals.get('us-4')).toBeDefined(); // look-ahead fill in flight

    harness.controller.selectRole('uk');
    await flush();

    expect(inflightSignals.get('us-4')!.aborted).toBe(true);
    const ukCalls = harness.fetchSegment.mock.calls.filter((call) => call[1] === 'uk');
    expect(ukCalls[0]!.slice(0, 4)).toEqual(['part-1', 'uk', 0, 'uk-hash-0']);
    expect(harness.audio.src).toBe('/audio/uk/0');
    expect(harness.controller.getState()).toMatchObject({ status: 'playing', role: 'uk', currentIndex: 0 });
  });

  it('does not consume the chapter-beginning flag while TTS is unavailable', async () => {
    const harness = createParagraphHarness();
    const container = renderMidChapter();

    await harness.controller.startFromVisibleParagraph(container); // part-1, segment 3

    harness.controller.setContext({ partId: 'part-2', ttsConfigured: false });
    harness.controller.toggle(container);
    await flush();

    expect(harness.onUnavailable).toHaveBeenCalledTimes(1);
    expect(harness.fetchSegment.mock.calls.some((call) => call[0] === 'part-2')).toBe(false);

    // TTS becomes available again — the flag survived: play still opens at segment 0.
    harness.controller.setContext({ partId: 'part-2', ttsConfigured: true });
    harness.controller.toggle(container);
    await flush();

    const part2Calls = harness.fetchSegment.mock.calls.filter((call) => call[0] === 'part-2');
    expect(part2Calls[0]!.slice(0, 4)).toEqual(['part-2', 'us', 0, 'us-hash-0']);
    expect(harness.controller.getState()).toMatchObject({ status: 'playing', currentIndex: 0 });
  });
});

describe('ReaderAudioController look-ahead buffer', () => {
  it('fills up to three segments after playback starts, each behind a blob URL', async () => {
    const harness = createHarness({
      fetchManifest: vi.fn(async (_partId: string, role: TestRole) => buildManifest(role, 6)),
    });
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);
    await flush();

    expect(harness.fetchSegment.mock.calls.map((call) => call[2]).sort()).toEqual([0, 1, 2, 3]);
    expect(harness.fetchAudioBytes.mock.calls.map((call) => String(call[0])).sort()).toEqual([
      '/audio/us/1',
      '/audio/us/2',
      '/audio/us/3',
    ]);
    expect(harness.createBlobUrl).toHaveBeenCalledTimes(3);
    // The 3-segment cap stops the fill before the chapter tail.
    expect(harness.fetchSegment.mock.calls.some((call) => call[2] >= 4)).toBe(false);
  });

  it('stops filling once buffered plus in-flight duration covers the 10s budget', async () => {
    const harness = createHarness({
      fetchSegment: vi.fn(async (_partId: string, role: TestRole, index: number) => ({
        ...buildSegmentPayload(role, index),
        durationMs: 6000,
      })),
    });
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);
    await flush();

    // Two 6s segments already cover the 10s look-ahead — a third would overshoot it.
    expect(harness.fetchAudioBytes.mock.calls.map((call) => String(call[0])).sort()).toEqual([
      '/audio/us/1',
      '/audio/us/2',
    ]);
  });

  it('completes the buffer during a short segment even when the next synthesis is slower', async () => {
    const nextSegment = createDeferred<ReaderAudioSegment>();
    let hasServedNext = false;
    const harness = createHarness({
      fetchSegment: vi.fn(async (_partId: string, role: TestRole, index: number) => {
        if (index === 1 && !hasServedNext) {
          hasServedNext = true;
          return nextSegment.promise; // synthesis slower than segment 0's playback
        }
        return buildSegmentPayload(role, index);
      }),
    });
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);
    await flush();
    expect(harness.audio.src).toBe('/audio/us/0');
    expect(harness.audio.playCalls).toBe(1);
    expect(harness.fetchAudioBytes.mock.calls.map((call) => String(call[0]))).not.toContain('/audio/us/1');

    // Synthesis resolves "mid-playback" of the short segment.
    nextSegment.resolve(buildSegmentPayload('us', 1));
    await flush();

    // Still on segment 0 — but segment 1's bytes are already in memory.
    expect(harness.audio.playCalls).toBe(1);
    expect(harness.fetchAudioBytes.mock.calls.map((call) => String(call[0]))).toContain('/audio/us/1');

    harness.audio.dispatch('ended');
    await flush();

    expect(harness.audio.src).toBe('blob:/audio/us/1');
    // The boundary did not re-request the buffered segment's bytes.
    expect(harness.fetchAudioBytes.mock.calls.filter((call) => call[0] === '/audio/us/1')).toHaveLength(1);
  });

  it('stop revokes every buffered blob and aborts in-flight byte fetches', async () => {
    const byteSignals = new Map<string, AbortSignal | undefined>();
    const fetchAudioBytes = vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      byteSignals.set(url, init?.signal);
      if (url.endsWith('/3')) {
        return new Promise<Blob>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortError()));
        });
      }
      return Promise.resolve(audioBytesBlob(url));
    });
    const harness = createHarness({
      fetchManifest: vi.fn(async (_partId: string, role: TestRole) => buildManifest(role, 6)),
      fetchAudioBytes,
    });
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);
    await flush();
    const createdBlobUrls = harness.createBlobUrl.mock.results.map((result) => result.value);
    expect(createdBlobUrls).toHaveLength(2); // segments 1–2 buffered; segment 3 still downloading
    const callsBeforeStop = harness.fetchAudioBytes.mock.calls.length;

    harness.controller.stop();

    expect(harness.revokeBlobUrl.mock.calls.map((call) => call[0]).sort()).toEqual([...createdBlobUrls].sort());
    expect(byteSignals.get('/audio/us/3')!.aborted).toBe(true);
    await flush();
    expect(harness.fetchAudioBytes.mock.calls.length).toBe(callsBeforeStop); // nothing refilled after stop
    harness.audio.dispatch('ended');
    await flush();
    expect(harness.fetchAudioBytes.mock.calls.length).toBe(callsBeforeStop);
    expect(harness.controller.getState()).toMatchObject({ status: 'idle', currentIndex: -1 });
  });

  it('role switching revokes every buffered blob and buffers only the new role afterwards', async () => {
    const harness = createHarness();
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);
    await flush();
    const usBlobUrls = harness.createBlobUrl.mock.results.map((result) => result.value);
    expect(usBlobUrls).toHaveLength(3);
    const byteCallsBeforeSwitch = harness.fetchAudioBytes.mock.calls.length;

    harness.controller.selectRole('uk');
    await flush();

    expect(harness.revokeBlobUrl.mock.calls.map((call) => call[0]).sort()).toEqual([...usBlobUrls].sort());
    const newByteCalls = harness.fetchAudioBytes.mock.calls.slice(byteCallsBeforeSwitch).map((call) => String(call[0]));
    expect(newByteCalls.length).toBeGreaterThan(0);
    expect(newByteCalls.every((url) => url.startsWith('/audio/uk/'))).toBe(true);
  });

  it('a failed byte fetch does not block playback — the boundary falls back to a network load', async () => {
    const harness = createHarness({
      fetchAudioBytes: vi.fn(async (url: string) => {
        if (url.endsWith('/1')) {
          throw new Error('boom');
        }
        return audioBytesBlob(url);
      }),
    });
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);
    await flush();
    // /1's bytes failed (no blob); the gap also stops the fill at /2.
    expect(harness.createBlobUrl).toHaveBeenCalledTimes(1);

    harness.audio.dispatch('ended'); // buffer miss for index 1 → fallback load
    await flush();

    expect(harness.audio.src).toBe('/audio/us/1');
    expect(harness.controller.getState().status).toBe('playing');
    expect(harness.onSegmentFailed).not.toHaveBeenCalled();

    // Buffering resumed past the failed index.
    expect(harness.fetchAudioBytes.mock.calls.map((call) => String(call[0]))).toContain('/audio/us/3');
  });

  it('never prefetches beyond the chapter end while filling or advancing', async () => {
    const harness = createHarness(); // 4 segments
    const container = renderContainer(0);

    await harness.controller.startFromVisibleParagraph(container);
    await flush();

    const overChapterEnd = () =>
      harness.fetchSegment.mock.calls.some((call) => call[2] >= 4) ||
      harness.fetchAudioBytes.mock.calls.some((call) => String(call[0]).endsWith('/4'));
    expect(overChapterEnd()).toBe(false);

    for (let advance = 0; advance < 4; advance++) {
      harness.audio.dispatch('ended');
      await flush();
    }

    expect(harness.controller.getState().status).toBe('idle'); // last segment done
    expect(overChapterEnd()).toBe(false);
  });
});

describe('ReaderAudioController chapter progress', () => {
  it('reports zero before playback starts', () => {
    const harness = createHarness();

    expect(harness.controller.getChapterProgress()).toBe(0);
  });

  it('weights completed segments by text length and adds the live segment fraction', async () => {
    const harness = createHarness();
    // Paragraph 1's first segment is index 2 of 4 — 20 of 40 characters are behind it.
    await harness.controller.startFromVisibleParagraph(renderContainer(1));
    await flush();

    expect(harness.controller.getChapterProgress()).toBeCloseTo(0.5, 5);

    // Halfway through the active segment (payload durationMs = 1000): 20 + 5 of 40.
    harness.audio.currentTime = 0.5;
    expect(harness.controller.getChapterProgress()).toBeCloseTo(0.625, 5);

    harness.audio.dispatch('ended');
    await flush();
    // The final segment completes the chapter, so the hairline fills up.
    harness.audio.currentTime = 1;
    expect(harness.controller.getChapterProgress()).toBeCloseTo(1, 5);
  });

  it('holds the completed boundary while the next segment is still loading', async () => {
    // Segment 1 never arrives, so no look-ahead buffer can hide the loading window.
    const harness = createHarness({
      fetchSegment: vi.fn(async (_partId: string, role: TestRole, index: number) => {
        if (index === 0) {
          return buildSegmentPayload(role, index);
        }
        return new Promise<never>(() => {});
      }),
    });
    await harness.controller.startFromVisibleParagraph(renderContainer(0));

    // Give the element a real media clock like a browser would report.
    Object.defineProperty(harness.audio, 'duration', { value: 1, configurable: true });
    harness.audio.currentTime = 0.5;
    expect(harness.controller.getChapterProgress()).toBeCloseTo(0.125, 5); // 5 of 40 characters

    // handleEnded starts loading index 1 synchronously; the element still holds
    // segment 0's media, so progress must not count segment 1 as complete.
    harness.audio.dispatch('ended');
    expect(harness.controller.getState()).toMatchObject({ status: 'loading', currentIndex: 1, segment: null });
    expect(harness.controller.getChapterProgress()).toBeCloseTo(0.25, 5); // 10 of 40 characters
  });

  it('restarts progress from zero when the voice switches', async () => {
    const harness = createHarness();
    await harness.controller.startFromVisibleParagraph(renderContainer(0));
    await flush();
    harness.audio.currentTime = 0.5;
    expect(harness.controller.getChapterProgress()).toBeGreaterThan(0);

    harness.controller.selectRole('uk');

    // The new role's manifest is not loaded yet, so no stale position leaks in.
    expect(harness.controller.getChapterProgress()).toBe(0);
  });

  it('resets to zero when the player stops', async () => {
    const harness = createHarness();
    // Starting at paragraph 1 means 20 of 40 characters are already behind the playhead.
    await harness.controller.startFromVisibleParagraph(renderContainer(1));
    await flush();
    harness.audio.currentTime += 0.25;
    expect(harness.controller.getChapterProgress()).toBeGreaterThan(0);

    harness.controller.stop();

    expect(harness.controller.getChapterProgress()).toBe(0);
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
