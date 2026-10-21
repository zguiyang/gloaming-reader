// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

import type { ReaderAudioManifest, ReaderAudioSegment } from '@gloaming/shared/reader';

import {
  READER_AUDIO_MANIFEST_STALE_CODE,
  ReaderAudioController,
  type ReaderAudioControllerState,
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
function buildManifest(role: TestRole, count = 4): ReaderAudioManifest {
  return {
    role,
    ttsConfigured: true,
    configFingerprint: `fp-${role}`,
    segments: Array.from({ length: count }, (_, index) => ({
      index,
      key: `p${Math.floor(index / 2)}:c${index % 2}`,
      segmentHash: `${role}-hash-${index}`,
      paragraphAnchor: String(Math.floor(index / 2)),
      paragraphTextOffset: (index % 2) * 10,
      textLength: 10,
    })),
  };
}

function buildSegmentPayload(role: TestRole, index: number): ReaderAudioSegment {
  const meta = buildManifest(role).segments[index]!;
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
    audioUrl: `/audio/${role}/${index}`,
  };
}

function stubRect(element: Element, top: number, bottom: number): void {
  element.getBoundingClientRect = () =>
    ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top }) as DOMRect;
}

/** Reading container whose viewport center lands in `centerParagraph` (0 or 1). */
function renderContainer(centerParagraph: 0 | 1): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="reading-body">
      <p data-p="0">Paragraph one.</p>
      <p data-p="1">Paragraph two.</p>
    </div>
  `;
  document.body.appendChild(container);
  const paragraphs = container.querySelectorAll('[data-p]');
  if (centerParagraph === 0) {
    stubRect(paragraphs[0]!, 0, 900);
    stubRect(paragraphs[1]!, 900, 1200);
  } else {
    stubRect(paragraphs[0]!, 0, 300);
    stubRect(paragraphs[1]!, 300, 900);
  }
  return container;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createHarness() {
  const states: ReaderAudioControllerState[] = [];
  const audio = new FakeAudio();
  const fetchManifest = vi.fn(async (_partId: string, role: TestRole) => buildManifest(role));
  const fetchSegment = vi.fn(async (_partId: string, role: TestRole, index: number) =>
    buildSegmentPayload(role, index),
  );
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
});
