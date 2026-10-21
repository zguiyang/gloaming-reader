import type { ReaderAudioManifest, ReaderAudioSegment } from '@gloaming/shared/reader';

import type { SegmentTimingInput } from '@/features/reader/audio/reader-audio-sync';
import {
  DEFAULT_READER_AUDIO_ROLE,
  type ReaderAudioRole,
  type ReaderAudioStatus,
} from '@/features/reader/reader-model';
import { ApiRequestError } from '@/lib/api-request';

/** Backend `ERROR_CODES.READER_AUDIO.MANIFEST_STALE` — refetch the manifest and replay. */
export const READER_AUDIO_MANIFEST_STALE_CODE = 'api.errors.readerAudio.manifestStale';

/** Active segment payload for word-level highlight, scoped to one paragraph chunk. */
export type ReaderAudioSegmentView = SegmentTimingInput & {
  index: number;
};

export type ReaderAudioControllerState = {
  status: ReaderAudioStatus;
  role: ReaderAudioRole;
  /** Segment index currently loading/playing; -1 when nothing is loaded. */
  currentIndex: number;
  /** Timings + paragraph anchor of the active segment; null while idle or loading. */
  segment: ReaderAudioSegmentView | null;
};

export type ReaderAudioManifestFetcher = (
  partId: string,
  role: ReaderAudioRole,
  init?: { signal?: AbortSignal },
) => Promise<ReaderAudioManifest>;

export type ReaderAudioSegmentFetcher = (
  partId: string,
  role: ReaderAudioRole,
  index: number,
  expectedHash: string | undefined,
  init?: { signal?: AbortSignal },
) => Promise<ReaderAudioSegment>;

export type ReaderAudioControllerDeps = {
  fetchManifest: ReaderAudioManifestFetcher;
  fetchSegment: ReaderAudioSegmentFetcher;
  /** Defaults to `new Audio()`; tests inject a fake element. */
  createAudio?: () => HTMLAudioElement;
  onStateChange: (state: ReaderAudioControllerState) => void;
  /** TTS is not configured for this actor — no segment request was sent. */
  onUnavailable?: () => void;
  /** Current segment failed to load or play — player is in `error`, tap play to retry. */
  onSegmentFailed?: () => void;
};

/**
 * Pick the paragraph driving playback start: the `[data-p]` element containing
 * the viewport center, else the topmost visible one, else the last paragraph
 * above the fold. Returns its anchor (`data-p` value) or null when none exist.
 */
export function resolveVisibleParagraphAnchor(root: ParentNode, viewportHeight: number): string | null {
  const paragraphs = Array.from(root.querySelectorAll('[data-p]'));
  if (paragraphs.length === 0) {
    return null;
  }
  const center = viewportHeight / 2;
  let firstVisible: Element | null = null;
  for (const element of paragraphs) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= 0) {
      continue;
    }
    if (rect.top <= center && center < rect.bottom) {
      return element.getAttribute('data-p');
    }
    if (!firstVisible) {
      firstVisible = element;
    }
  }
  const target = firstVisible ?? paragraphs[paragraphs.length - 1]!;
  return target.getAttribute('data-p');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isManifestStaleError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409 && error.code === READER_AUDIO_MANIFEST_STALE_CODE;
}

type InflightSegmentRequest = {
  role: ReaderAudioRole;
  index: number;
  abort: AbortController;
  /** Catch-wrapped twin that never rejects — safe for adopters. */
  promise: Promise<ReaderAudioSegment | null>;
};

type SegmentRequestResult =
  { kind: 'payload'; payload: ReaderAudioSegment } | { kind: 'aborted' } | { kind: 'stale' } | { kind: 'error' };

/**
 * Lazy per-segment listen player. One audio element, one in-flight segment
 * request, silent next-1 prefetch, abort-on-switch lifecycle. Pure logic —
 * DOM access is limited to the reading container passed into `toggle`, and
 * every external effect (toasts, state) goes through injected deps.
 */
export class ReaderAudioController {
  private readonly deps: ReaderAudioControllerDeps;
  private partId: string | null = null;
  private ttsConfigured = false;
  private role: ReaderAudioRole = DEFAULT_READER_AUDIO_ROLE;
  private status: ReaderAudioStatus = 'idle';
  private currentIndex = -1;
  private currentSegment: ReaderAudioSegmentView | null = null;
  private readonly manifests = new Map<ReaderAudioRole, ReaderAudioManifest>();
  private readonly segmentCache = new Map<string, ReaderAudioSegment>();
  private inflight: InflightSegmentRequest | null = null;
  private manifestAbort: AbortController | null = null;
  private audio: HTMLAudioElement | null = null;
  private playbackRate = 1;
  /** Bumped on stop / role switch / context change — invalidates stale continuations. */
  private session = 0;

  constructor(deps: ReaderAudioControllerDeps) {
    this.deps = deps;
  }

  getState(): ReaderAudioControllerState {
    return {
      status: this.status,
      role: this.role,
      currentIndex: this.currentIndex,
      segment: this.currentSegment,
    };
  }

  /** Chapter/part changes tear the player down; TTS availability follows the open part. */
  setContext(input: { partId: string | null; ttsConfigured: boolean }): void {
    if (input.partId !== this.partId) {
      this.stop();
    }
    this.partId = input.partId;
    this.ttsConfigured = input.ttsConfigured;
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = rate;
    if (this.audio) {
      this.audio.playbackRate = rate;
    }
  }

  /** Live audio element backing playback — null until the first segment plays. */
  getAudioElement(): HTMLAudioElement | null {
    return this.audio;
  }

  toggle(container: ParentNode | null): void {
    switch (this.status) {
      case 'playing':
        this.pause();
        return;
      case 'paused':
        void this.resume();
        return;
      case 'error':
        void this.retryCurrent(container);
        return;
      default:
        void this.startFromVisibleParagraph(container);
    }
  }

  /** Start (or restart) from the paragraph currently under the reader's eyes. */
  async startFromVisibleParagraph(container: ParentNode | null): Promise<void> {
    if (!this.partId) {
      return;
    }
    if (!this.ttsConfigured) {
      this.deps.onUnavailable?.();
      return;
    }
    if (this.status === 'loading') {
      return;
    }
    const readingBody =
      container && 'querySelector' in container ? (container.querySelector('.reading-body') ?? container) : null;
    const anchor = readingBody ? resolveVisibleParagraphAnchor(readingBody, viewportHeight()) : null;
    const manifest = await this.ensureManifest(this.role);
    if (!manifest) {
      return;
    }
    if (!manifest.ttsConfigured) {
      this.stop();
      this.deps.onUnavailable?.();
      return;
    }
    await this.loadSegment(this.resolveSegmentIndex(manifest, anchor));
  }

  pause(): void {
    if (this.status !== 'playing') {
      return;
    }
    this.audio?.pause();
    this.setStatus('paused');
  }

  /**
   * Switch voice role. Aborts the in-flight request, drops cached segments and
   * restarts from the first segment of the paragraph being listened to — the
   * new role's index/anchor mapping comes from its own manifest.
   */
  selectRole(role: ReaderAudioRole): void {
    if (role === this.role) {
      return;
    }
    const shouldRestart = this.status !== 'idle';
    const anchor =
      this.currentSegment?.paragraphAnchor ??
      this.manifests.get(this.role)?.segments[this.currentIndex]?.paragraphAnchor ??
      null;
    this.session++;
    this.abortRequests();
    this.audio?.pause();
    this.segmentCache.clear();
    this.role = role;
    if (!shouldRestart) {
      this.setCurrent(-1, null);
      this.setStatus('idle');
      return;
    }
    void this.restartFromAnchor(anchor);
  }

  /** Abort every request, drop caches, release highlight state. Idempotent. */
  stop(): void {
    this.session++;
    this.abortRequests();
    if (this.audio) {
      this.audio.pause();
      try {
        this.audio.removeAttribute('src');
        this.audio.load();
      } catch {
        // Teardown is best-effort — some environments do not implement load().
      }
    }
    this.segmentCache.clear();
    this.manifests.clear();
    this.setCurrent(-1, null);
    this.setStatus('idle');
  }

  destroy(): void {
    this.stop();
    if (this.audio) {
      this.audio.removeEventListener('ended', this.handleEnded);
      this.audio.removeEventListener('error', this.handleAudioError);
    }
    this.audio = null;
  }

  private async resume(): Promise<void> {
    const audio = this.audio;
    if (!audio || this.currentIndex < 0) {
      return;
    }
    const session = this.session;
    try {
      await audio.play();
    } catch {
      if (session !== this.session) return;
      this.failSegment();
      return;
    }
    if (session !== this.session) return;
    this.setStatus('playing');
    void this.prefetchSegment(this.currentIndex + 1);
  }

  private async retryCurrent(container: ParentNode | null): Promise<void> {
    if (this.currentIndex >= 0) {
      await this.loadSegment(this.currentIndex);
      return;
    }
    // Manifest fetch itself failed — restart from the visible paragraph.
    await this.startFromVisibleParagraph(container);
  }

  private async restartFromAnchor(anchor: string | null): Promise<void> {
    const manifest = await this.ensureManifest(this.role);
    if (!manifest) {
      return;
    }
    if (!manifest.ttsConfigured) {
      this.stop();
      this.deps.onUnavailable?.();
      return;
    }
    await this.loadSegment(this.resolveSegmentIndex(manifest, anchor));
  }

  /** First segment belonging to `anchor`; index 0 when the anchor is gone. */
  private resolveSegmentIndex(manifest: ReaderAudioManifest, anchor: string | null): number {
    if (anchor == null) {
      return 0;
    }
    return manifest.segments.find((segment) => segment.paragraphAnchor === anchor)?.index ?? 0;
  }

  private async ensureManifest(role: ReaderAudioRole): Promise<ReaderAudioManifest | null> {
    const cached = this.manifests.get(role);
    if (cached) {
      return cached;
    }
    const partId = this.partId;
    if (!partId) {
      return null;
    }
    this.abortManifest();
    const abort = new AbortController();
    this.manifestAbort = abort;
    const session = this.session;
    this.setStatus('loading');
    try {
      const manifest = await this.deps.fetchManifest(partId, role, { signal: abort.signal });
      if (session !== this.session) {
        return null;
      }
      this.manifests.set(role, manifest);
      return manifest;
    } catch (error) {
      if (session !== this.session || isAbortError(error)) {
        return null;
      }
      this.failSegment();
      return null;
    } finally {
      if (this.manifestAbort === abort) {
        this.manifestAbort = null;
      }
    }
  }

  private async loadSegment(index: number, options?: { allowManifestRefresh?: boolean }): Promise<void> {
    const manifest = this.manifests.get(this.role);
    if (!this.partId || !manifest) {
      return;
    }
    if (index < 0 || index >= manifest.segments.length) {
      this.stop();
      return;
    }
    const session = this.session;
    this.setCurrent(index, null);
    this.setStatus('loading');
    const result = await this.requestSegment(index);
    if (session !== this.session) {
      return;
    }
    if (result.kind === 'aborted') {
      return;
    }
    if (result.kind === 'stale') {
      if (options?.allowManifestRefresh === false) {
        this.failSegment();
        return;
      }
      this.manifests.delete(this.role);
      const anchor = manifest.segments[index]?.paragraphAnchor ?? null;
      const refreshed = await this.ensureManifest(this.role);
      if (!refreshed || session !== this.session) {
        return;
      }
      await this.loadSegment(this.resolveSegmentIndex(refreshed, anchor), { allowManifestRefresh: false });
      return;
    }
    if (result.kind === 'error') {
      this.failSegment();
      return;
    }
    await this.playSegment(result.payload, index, session);
  }

  /**
   * Single in-flight segment slot: reuse a matching request, otherwise abort
   * the previous one. Ready results land in the per-role cache.
   */
  private async requestSegment(index: number): Promise<SegmentRequestResult> {
    const partId = this.partId;
    const role = this.role;
    const meta = this.manifests.get(role)?.segments[index];
    if (!partId || !meta) {
      return { kind: 'error' };
    }
    const cacheKey = `${role}:${index}`;
    const cached = this.segmentCache.get(cacheKey);
    if (cached) {
      return { kind: 'payload', payload: cached };
    }
    const existing = this.inflight;
    if (existing && existing.role === role && existing.index === index) {
      const payload = await existing.promise;
      return payload ? { kind: 'payload', payload } : { kind: 'aborted' };
    }
    this.abortSegment();
    const abort = new AbortController();
    const session = this.session;
    const promise = this.deps
      .fetchSegment(partId, role, index, meta.segmentHash, { signal: abort.signal })
      .then((payload) => {
        if (session === this.session) {
          this.segmentCache.set(cacheKey, payload);
        }
        return payload;
      })
      .finally(() => {
        if (this.inflight?.abort === abort) {
          this.inflight = null;
        }
      });
    const record: InflightSegmentRequest = {
      role,
      index,
      abort,
      promise: promise.catch(() => null),
    };
    this.inflight = record;
    try {
      const payload = await promise;
      if (session !== this.session) {
        return { kind: 'aborted' };
      }
      return { kind: 'payload', payload };
    } catch (error) {
      if (session !== this.session || isAbortError(error)) {
        return { kind: 'aborted' };
      }
      if (isManifestStaleError(error)) {
        return { kind: 'stale' };
      }
      return { kind: 'error' };
    }
  }

  /** Silent next-1 prefetch — one page ahead, never blocks playback. */
  private async prefetchSegment(index: number): Promise<void> {
    const manifest = this.manifests.get(this.role);
    if (!manifest || index < 0 || index >= manifest.segments.length) {
      return;
    }
    if (this.inflight) {
      return;
    }
    // Failures stay silent; playback re-requests when it reaches the segment.
    await this.requestSegment(index);
  }

  private async playSegment(payload: ReaderAudioSegment, index: number, session: number): Promise<void> {
    const audio = this.ensureAudio();
    audio.src = payload.audioUrl;
    audio.playbackRate = this.playbackRate;
    this.setCurrent(index, {
      index,
      paragraphAnchor: payload.paragraphAnchor,
      paragraphTextOffset: payload.paragraphTextOffset,
      textLength: this.manifests.get(this.role)?.segments[index]?.textLength ?? 0,
      wordTimings: payload.wordTimings,
    });
    try {
      await audio.play();
    } catch {
      if (session !== this.session) return;
      this.failSegment();
      return;
    }
    if (session !== this.session) return;
    this.setStatus('playing');
    void this.prefetchSegment(index + 1);
  }

  private ensureAudio(): HTMLAudioElement {
    if (this.audio) {
      return this.audio;
    }
    const audio = this.deps.createAudio ? this.deps.createAudio() : new Audio();
    audio.addEventListener('ended', this.handleEnded);
    audio.addEventListener('error', this.handleAudioError);
    this.audio = audio;
    return audio;
  }

  /** `ended` advances one segment; the chapter's last segment stops playback. */
  private readonly handleEnded = (): void => {
    if (this.status !== 'playing') {
      return;
    }
    const next = this.currentIndex + 1;
    const manifest = this.manifests.get(this.role);
    if (manifest && next < manifest.segments.length) {
      void this.loadSegment(next);
      return;
    }
    this.stop();
  };

  private readonly handleAudioError = (): void => {
    if (this.status === 'idle' || this.status === 'error') {
      return;
    }
    this.failSegment();
  };

  private failSegment(): void {
    this.setStatus('error');
    this.deps.onSegmentFailed?.();
  }

  private abortRequests(): void {
    this.abortSegment();
    this.abortManifest();
  }

  private abortSegment(): void {
    this.inflight?.abort.abort();
    this.inflight = null;
  }

  private abortManifest(): void {
    this.manifestAbort?.abort();
    this.manifestAbort = null;
  }

  private setCurrent(index: number, segment: ReaderAudioSegmentView | null): void {
    this.currentIndex = index;
    this.currentSegment = segment;
    this.emit();
  }

  private setStatus(status: ReaderAudioStatus): void {
    this.status = status;
    this.emit();
  }

  private emit(): void {
    this.deps.onStateChange(this.getState());
  }
}

function viewportHeight(): number {
  return typeof window !== 'undefined' ? window.innerHeight || 0 : 0;
}
