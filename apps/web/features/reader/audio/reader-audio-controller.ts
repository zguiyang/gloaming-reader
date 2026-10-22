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
  /** Segment audio duration when the synthesis payload carried one — progress fallback. */
  durationMs: number | null;
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

/** Fetches buffered segment audio bytes; defaults to a credentialed same-origin fetch. */
export type ReaderAudioByteFetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Blob>;

export type ReaderAudioControllerDeps = {
  fetchManifest: ReaderAudioManifestFetcher;
  fetchSegment: ReaderAudioSegmentFetcher;
  /** Defaults to `fetch(url, { credentials: 'include' })` + an ok check. */
  fetchAudioBytes?: ReaderAudioByteFetcher;
  /** Blob URL creation for buffered bytes; defaults to `URL.createObjectURL`. */
  createBlobUrl?: (blob: Blob) => string;
  /** Blob URL release; defaults to `URL.revokeObjectURL`. */
  revokeBlobUrl?: (url: string) => void;
  /** Defaults to `new Audio()`; tests inject a fake element. */
  createAudio?: () => HTMLAudioElement;
  onStateChange: (state: ReaderAudioControllerState) => void;
  /** TTS is not configured for this actor — no segment request was sent. */
  onUnavailable?: () => void;
  /** Current segment failed to load or play — player is in `error`, tap play to retry. */
  onSegmentFailed?: () => void;
};

/**
 * Pick the paragraph driving playback start: the topmost visible `[data-p]`
 * element — the first one intersecting the viewport from the top (partially
 * visible counts). The viewport center is deliberately not used: a chapter's
 * opening is often a short title paragraph, so the center would land in the
 * second paragraph and skip the chapter's beginning. When nothing is visible,
 * content below the fold starts at the first paragraph, and content scrolled
 * past (end of chapter) starts at the last. Returns its anchor (`data-p`
 * value) or null when none exist.
 */
export function resolveVisibleParagraphAnchor(root: ParentNode, viewportHeight: number): string | null {
  const paragraphs = Array.from(root.querySelectorAll('[data-p]'));
  if (paragraphs.length === 0) {
    return null;
  }
  let firstBelowFold: Element | null = null;
  let lastAboveFold: Element | null = null;
  for (const element of paragraphs) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < viewportHeight) {
      return element.getAttribute('data-p');
    }
    if (rect.bottom <= 0) {
      lastAboveFold = element;
    } else {
      firstBelowFold ??= element;
    }
  }
  const target = firstBelowFold ?? lastAboveFold ?? paragraphs[0]!;
  return target.getAttribute('data-p');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Keep this much real-duration audio buffered ahead of the playhead. */
const BUFFER_AHEAD_MS = 10_000;
/** Hard cap on buffered segments ahead of the playhead. */
const BUFFER_MAX_SEGMENTS = 3;
/** Concurrent segment preparations (metadata + byte download) while buffering. */
const BUFFER_CONCURRENCY = 2;
/** English TTS speaks roughly 15 characters per second — duration estimate fallback. */
const BUFFER_DURATION_CHARS_PER_SECOND = 15;

async function defaultFetchAudioBytes(url: string, init?: { signal?: AbortSignal }): Promise<Blob> {
  const response = await fetch(url, { credentials: 'include', signal: init?.signal });
  if (!response.ok) {
    throw new Error(`Failed to buffer reader audio bytes: ${response.status}`);
  }
  return response.blob();
}

/** A synthesized segment whose bytes are already in memory behind a blob URL. */
type BufferedSegment = {
  payload: ReaderAudioSegment;
  blobUrl: string;
  durationMs: number;
};

function isManifestStaleError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409 && error.code === READER_AUDIO_MANIFEST_STALE_CODE;
}

type InflightSegmentRequest = {
  role: ReaderAudioRole;
  index: number;
  abort: AbortController;
  /** Never-rejecting twin carrying the real outcome — adopters must not confuse a failure with an abort. */
  promise: Promise<SegmentRequestResult>;
};

type SegmentRequestResult =
  { kind: 'payload'; payload: ReaderAudioSegment } | { kind: 'aborted' } | { kind: 'stale' } | { kind: 'error' };

/**
 * Lazy per-segment listen player with a video-style look-ahead buffer. One
 * audio element; ahead of the playhead up to 10s / 3 segments of audio are
 * synthesized and downloaded into blob URLs, so segment boundaries play from
 * memory instead of the network. Abort-on-switch lifecycle. Pure logic — DOM
 * access is limited to the reading container passed into `toggle`, and every
 * external effect (toasts, state, network, blob URLs) goes through injected
 * deps.
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
  /** Keyed metadata requests — playback plus up to `BUFFER_CONCURRENCY` buffer fills. */
  private readonly inflight = new Map<string, InflightSegmentRequest>();
  /** Look-ahead buffer: synthesized + downloaded segments keyed by index. */
  private readonly buffer = new Map<number, BufferedSegment>();
  /** In-flight buffer preparations (metadata and/or byte download) keyed by index. */
  private readonly preparing = new Map<
    number,
    { abort: AbortController; promise: Promise<void>; durationMs: number | null }
  >();
  /** Indexes whose buffer fill failed — retried when playback reaches them, not in a loop. */
  private readonly bufferFailed = new Set<number>();
  /** Bumped whenever the buffer is invalidated by manifest_stale — kills running fill loops. */
  private bufferEpoch = 0;
  /** Identity of the running fill loop — one per session+epoch at most. */
  private bufferRun: { session: number; epoch: number } | null = null;
  /**
   * Set when the chapter changes (or while its replacement is still loading):
   * the next successful start plays segment 0 instead of the visible
   * paragraph. Consumed only on a start that actually reaches its manifest.
   */
  private startAtChapterBeginning = false;
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
    // Any change away from an established part is a chapter switch — including
    // the transient null while the next part (React Query key change) is still
    // loading. After a switch the next play must open the new chapter at its
    // beginning, not resume from the reader's scroll position. A fresh
    // controller's first acquisition (null → id) is not a switch, so first
    // open keeps the visible-paragraph start.
    const hasPartChanged = this.partId !== null && input.partId !== this.partId;
    if (hasPartChanged) {
      this.startAtChapterBeginning = true;
    }
    // Losing TTS availability mid-listen (e.g. an admin disables the voice)
    // must stop playback and drop the cached manifest/segments.
    if (input.partId !== this.partId || (this.ttsConfigured && !input.ttsConfigured)) {
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

  /**
   * Fraction of the chapter already spoken, 0–1. Chapters are synthesized
   * lazily per paragraph, so there is no precomputed total duration; segment
   * text length is the stable weight, and the live audio clock supplies the
   * position inside the current segment. Callers may sample this on a timer —
   * it reads state without emitting React updates.
   */
  getChapterProgress(): number {
    const manifest = this.manifests.get(this.role);
    if (!manifest || this.currentIndex < 0) {
      return 0;
    }
    const totalTextLength = manifest.segments.reduce((sum, segment) => sum + segment.textLength, 0);
    if (totalTextLength <= 0) {
      return 0;
    }
    let spokenTextLength = 0;
    for (const segment of manifest.segments) {
      if (segment.index < this.currentIndex) {
        spokenTextLength += segment.textLength;
      } else if (segment.index === this.currentIndex) {
        spokenTextLength += segment.textLength * this.currentSegmentFraction();
        break;
      }
    }
    return Math.min(1, Math.max(0, spokenTextLength / totalTextLength));
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
    if (this.startAtChapterBeginning) {
      // Chapter switch: open the new chapter from its first segment, whatever
      // the reader's scroll position shows. Consumed here — an earlier return
      // (TTS unconfigured, manifest fetch failure) keeps it for the next try.
      this.startAtChapterBeginning = false;
      await this.loadSegment(0);
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
   * restarts from the chapter's first segment — a voice change re-speaks the
   * chapter from the top with the new voice, independent of the listening
   * position.
   */
  selectRole(role: ReaderAudioRole): void {
    if (role === this.role) {
      return;
    }
    const shouldRestart = this.status !== 'idle';
    this.session++;
    this.abortRequests();
    this.audio?.pause();
    this.segmentCache.clear();
    this.bufferFailed.clear();
    this.role = role;
    if (!shouldRestart) {
      this.setCurrent(-1, null);
      this.setStatus('idle');
      return;
    }
    // Playing/paused/loading/error: restart immediately from segment 0 — this
    // start supersedes any pending chapter-beginning flag.
    this.startAtChapterBeginning = false;
    void this.restartFromAnchor(null);
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
    this.bufferFailed.clear();
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
    void this.fillBuffer();
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

  /**
   * Map a paragraph anchor to its playback start segment: the first segment of
   * that paragraph, else the first segment whose paragraph comes at-or-after it
   * in document order (`data-p` ordinals are document-order numbers, and
   * manifest segments are in ascending order), so an image-only or
   * punctuation-only visible paragraph starts at the next playable one. When
   * nothing follows (e.g. a trailing image), start from the last playable
   * segment — nearest to the reader's position — and fall back to index 0 for
   * a missing or non-ordinal anchor.
   */
  private resolveSegmentIndex(manifest: ReaderAudioManifest, anchor: string | null): number {
    if (anchor == null) {
      return 0;
    }
    const exact = manifest.segments.find((segment) => segment.paragraphAnchor === anchor);
    if (exact) {
      return exact.index;
    }
    const ordinal = Number(anchor);
    if (!Number.isFinite(ordinal)) {
      return 0;
    }
    const next = manifest.segments.find((segment) => Number(segment.paragraphAnchor) >= ordinal);
    return next?.index ?? manifest.segments[manifest.segments.length - 1]?.index ?? 0;
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
      // The server regenerated the chapter: every cached payload and any
      // in-flight request carries an old hash whose stream URL would 404 —
      // drop them all so the replay after the manifest refresh cannot hit
      // the stale cache. The replayed request reads the new expectedHash
      // from the refreshed manifest.
      this.abortSegment();
      this.abortBufferSegments();
      this.segmentCache.clear();
      this.bufferFailed.clear();
      this.clearBuffer();
      this.bufferEpoch += 1;
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
   * Keyed single-flight per segment: reuse a matching request, never abort a
   * different one (playback and buffer fills coexist). Ready results land in
   * the per-role cache.
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
    const session = this.session;
    const existing = this.inflight.get(cacheKey);
    if (existing) {
      // Reused requests report the real outcome — a network/server failure must
      // surface as `error` (retryable), never masquerade as an abort.
      const result = await existing.promise;
      return session === this.session ? result : { kind: 'aborted' };
    }
    const abort = new AbortController();
    const promise = (async (): Promise<SegmentRequestResult> => {
      try {
        const payload = await this.deps.fetchSegment(partId, role, index, meta.segmentHash, {
          signal: abort.signal,
        });
        if (session !== this.session) {
          return { kind: 'aborted' };
        }
        this.segmentCache.set(cacheKey, payload);
        return { kind: 'payload', payload };
      } catch (error) {
        // Only a caller abort / session change counts as aborted; anything
        // else is a real failure the playback path must observe.
        if (session !== this.session || isAbortError(error)) {
          return { kind: 'aborted' };
        }
        if (isManifestStaleError(error)) {
          return { kind: 'stale' };
        }
        return { kind: 'error' };
      } finally {
        if (this.inflight.get(cacheKey)?.abort === abort) {
          this.inflight.delete(cacheKey);
        }
      }
    })();
    this.inflight.set(cacheKey, { role, index, abort, promise });
    const result = await promise;
    return session === this.session ? result : { kind: 'aborted' };
  }

  /**
   * Keep up to `BUFFER_AHEAD_MS` / `BUFFER_MAX_SEGMENTS` of synthesized,
   * downloaded audio ahead of the playhead. One loop per session; each
   * segment preparation (metadata + bytes) runs concurrently up to
   * `BUFFER_CONCURRENCY` and stops at chapter end. Failures are silent —
   * playback re-requests when it reaches the failed segment.
   */
  private fillBuffer(): void {
    const session = this.session;
    const epoch = this.bufferEpoch;
    const current = this.bufferRun;
    if (current && current.session === session && current.epoch === epoch) {
      return;
    }
    this.bufferRun = { session, epoch };
    void (async () => {
      try {
        await this.fillLoop(session, epoch);
      } finally {
        if (this.bufferRun && this.bufferRun.session === session && this.bufferRun.epoch === epoch) {
          this.bufferRun = null;
        }
      }
    })();
  }

  private async fillLoop(session: number, epoch: number): Promise<void> {
    while (session === this.session && epoch === this.bufferEpoch) {
      const manifest = this.manifests.get(this.role);
      if (!manifest) {
        return;
      }
      // Consecutive buffered duration/segments from the next index onward.
      let aheadMs = 0;
      let aheadCount = 0;
      let scan = this.currentIndex + 1;
      while (this.buffer.has(scan)) {
        aheadMs += this.buffer.get(scan)!.durationMs;
        aheadCount += 1;
        scan += 1;
      }
      // In-flight fills with known durations count toward the budget so a
      // burst of short segments cannot overshoot the 10s ceiling.
      let pendingMs = 0;
      for (const entry of this.preparing.values()) {
        pendingMs += entry.durationMs ?? 0;
      }
      if (aheadMs + pendingMs >= BUFFER_AHEAD_MS || aheadCount >= BUFFER_MAX_SEGMENTS) {
        return;
      }
      let started = 0;
      for (let index = scan; index < manifest.segments.length && index <= scan + 1; index++) {
        if (this.buffer.has(index) || this.bufferFailed.has(index) || this.preparing.has(index)) {
          continue;
        }
        if (this.preparing.size >= BUFFER_CONCURRENCY || this.futureBufferCount() >= BUFFER_MAX_SEGMENTS) {
          break;
        }
        this.startBufferSegment(index, session);
        started += 1;
      }
      if (started === 0) {
        if (this.preparing.size === 0) {
          // Chapter end, a failed index nothing can advance past, or limits met.
          return;
        }
        await Promise.race([...this.preparing.values()].map((entry) => entry.promise));
      }
    }
  }

  /** Buffered + in-flight segments ahead of the playhead — feeds the 3-segment cap. */
  private futureBufferCount(): number {
    let count = this.preparing.size;
    for (const index of this.buffer.keys()) {
      if (index > this.currentIndex) {
        count += 1;
      }
    }
    return count;
  }

  private startBufferSegment(index: number, session: number): void {
    const abort = new AbortController();
    const entry: { abort: AbortController; promise: Promise<void>; durationMs: number | null } = {
      abort,
      durationMs: null,
      promise: Promise.resolve(),
    };
    this.preparing.set(index, entry);
    entry.promise = this.bufferSegment(index, abort, session).finally(() => {
      if (this.preparing.get(index)?.abort === abort) {
        this.preparing.delete(index);
      }
    });
  }

  /** Synthesize one segment, download its bytes and park them behind a blob URL. */
  private async bufferSegment(index: number, abort: AbortController, session: number): Promise<void> {
    try {
      const result = await this.requestSegment(index);
      if (session !== this.session || abort.signal.aborted) {
        return;
      }
      if (result.kind === 'stale') {
        // The server regenerated the chapter: drop buffered bytes and warm
        // caches so no stale-generation payload can be served, block an
        // immediate retry loop, and let playback hit the manifest_stale
        // recovery when it reaches this index. Only buffer-side work is
        // aborted here — aborting the shared metadata slot could cancel the
        // playback request and strand it in `loading`.
        this.abortBufferSegments();
        this.segmentCache.clear();
        this.clearBuffer();
        this.bufferEpoch += 1;
        this.bufferFailed.add(index);
        return;
      }
      if (result.kind !== 'payload') {
        if (result.kind === 'error') {
          this.bufferFailed.add(index);
        }
        return;
      }
      if (index <= this.currentIndex) {
        return; // playback already passed it — no bytes needed
      }
      const payload = result.payload;
      const durationMs = this.resolveDurationMs(payload, index);
      const pending = this.preparing.get(index);
      if (pending?.abort === abort) {
        pending.durationMs = durationMs; // feeds the fill budget while bytes download
      }
      const fetchBytes = this.deps.fetchAudioBytes ?? defaultFetchAudioBytes;
      const blob = await fetchBytes(payload.audioUrl, { signal: abort.signal });
      if (session !== this.session || abort.signal.aborted || index <= this.currentIndex) {
        return;
      }
      const blobUrl = this.createBlobUrl(blob);
      if (session !== this.session || abort.signal.aborted) {
        this.revokeBlobUrl(blobUrl);
        return;
      }
      this.buffer.set(index, { payload, blobUrl, durationMs });
    } catch (error) {
      // Silent: playback re-requests when it reaches the segment. Aborts are
      // lifecycle noise, not failures worth retrying.
      if (session === this.session && !abort.signal.aborted && !isAbortError(error)) {
        this.bufferFailed.add(index);
      }
    }
  }

  private resolveDurationMs(payload: ReaderAudioSegment, index: number): number {
    if (payload.durationMs != null) {
      return payload.durationMs;
    }
    const textLength = this.manifests.get(this.role)?.segments[index]?.textLength ?? 0;
    return Math.round((textLength / BUFFER_DURATION_CHARS_PER_SECOND) * 1000);
  }

  private createBlobUrl(blob: Blob): string {
    return this.deps.createBlobUrl ? this.deps.createBlobUrl(blob) : URL.createObjectURL(blob);
  }

  private revokeBlobUrl(url: string): void {
    if (this.deps.revokeBlobUrl) {
      this.deps.revokeBlobUrl(url);
      return;
    }
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  }

  /** Release buffered blobs outside `[centerIndex, centerIndex + BUFFER_MAX_SEGMENTS]`. */
  private pruneBuffer(centerIndex: number): void {
    for (const [index, entry] of this.buffer) {
      if (index < centerIndex || index > centerIndex + BUFFER_MAX_SEGMENTS) {
        this.revokeBlobUrl(entry.blobUrl);
        this.buffer.delete(index);
      }
    }
    for (const index of this.bufferFailed) {
      if (index < centerIndex || index > centerIndex + BUFFER_MAX_SEGMENTS) {
        this.bufferFailed.delete(index);
      }
    }
  }

  private clearBuffer(): void {
    for (const entry of this.buffer.values()) {
      this.revokeBlobUrl(entry.blobUrl);
    }
    this.buffer.clear();
  }

  private async playSegment(payload: ReaderAudioSegment, index: number, session: number): Promise<void> {
    const audio = this.ensureAudio();
    audio.src = payload.audioUrl;
    audio.playbackRate = this.playbackRate;
    this.setCurrent(index, this.toSegmentView(payload, index));
    this.pruneBuffer(index);
    // Start buffering the look-ahead immediately — it fills while the first
    // segment's audio still downloads/plays.
    void this.fillBuffer();
    try {
      await audio.play();
    } catch {
      if (session !== this.session) return;
      this.failSegment();
      return;
    }
    if (session !== this.session) return;
    this.setStatus('playing');
  }

  /** Advance from the look-ahead buffer: blob src, no network on the boundary. */
  private async playFromBuffer(index: number, entry: BufferedSegment, session: number): Promise<void> {
    const audio = this.ensureAudio();
    audio.src = entry.blobUrl;
    audio.playbackRate = this.playbackRate;
    this.setCurrent(index, this.toSegmentView(entry.payload, index));
    // The old segment's blob is spent and out-of-window ones are dead weight.
    this.pruneBuffer(index);
    void this.fillBuffer();
    try {
      await audio.play();
    } catch {
      if (session !== this.session) return;
      this.failSegment();
      return;
    }
    if (session !== this.session) return;
    this.setStatus('playing');
  }

  private toSegmentView(payload: ReaderAudioSegment, index: number): ReaderAudioSegmentView {
    return {
      index,
      paragraphAnchor: payload.paragraphAnchor,
      paragraphTextOffset: payload.paragraphTextOffset,
      textLength: this.manifests.get(this.role)?.segments[index]?.textLength ?? 0,
      durationMs: payload.durationMs,
      wordTimings: payload.wordTimings,
    };
  }

  /**
   * Position inside the active segment, 0–1, from the live audio clock.
   * Returns 0 while the next segment is still loading: the element then still
   * holds the previous segment's media, and reading its clock would count the
   * new segment as complete and make the bar jump a whole segment forward.
   */
  private currentSegmentFraction(): number {
    const audio = this.audio;
    const segment = this.currentSegment;
    if (!audio || !segment || this.currentIndex < 0) {
      return 0;
    }
    const durationMs = this.currentSegmentDurationMs();
    if (durationMs <= 0) {
      return 0;
    }
    const currentTimeMs = (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) * 1000;
    return Math.min(1, Math.max(0, currentTimeMs / durationMs));
  }

  /**
   * Real duration when the element knows it, else the synthesis payload, else
   * word timings, else a text-length estimate — segments without a usable
   * duration must not freeze the bar inside the segment.
   */
  private currentSegmentDurationMs(): number {
    const segment = this.currentSegment;
    if (!segment) {
      return 0;
    }
    const audio = this.audio;
    if (audio && typeof audio.duration === 'number' && Number.isFinite(audio.duration) && audio.duration > 0) {
      return audio.duration * 1000;
    }
    if (segment.durationMs != null && segment.durationMs > 0) {
      return segment.durationMs;
    }
    const lastTiming = segment.wordTimings[segment.wordTimings.length - 1];
    if (lastTiming) {
      return lastTiming.audioOffsetMs + lastTiming.durationMs;
    }
    return segment.textLength > 0 ? Math.round((segment.textLength / BUFFER_DURATION_CHARS_PER_SECOND) * 1000) : 0;
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

  /** `ended` advances one segment — from memory when buffered, else via load. */
  private readonly handleEnded = (): void => {
    if (this.status !== 'playing') {
      return;
    }
    const next = this.currentIndex + 1;
    const manifest = this.manifests.get(this.role);
    if (manifest && next < manifest.segments.length) {
      const buffered = this.buffer.get(next);
      if (buffered) {
        void this.playFromBuffer(next, buffered, this.session);
        return;
      }
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
    this.abortBufferSegments();
    this.clearBuffer();
    this.bufferFailed.clear();
  }

  private abortSegment(): void {
    for (const entry of this.inflight.values()) {
      entry.abort.abort();
    }
    this.inflight.clear();
  }

  /** Abort in-flight buffer fills — byte fetches observe their signal. */
  private abortBufferSegments(): void {
    for (const entry of this.preparing.values()) {
      entry.abort.abort();
    }
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
