import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReaderAudioConfig } from '@/domains/reader-audio/config';
import { resolveReaderAudioConfig } from '@/domains/reader-audio/config';
import { buildReaderAudioAttemptStorageKey, buildReaderAudioIdentity } from '@/domains/reader-audio/identity';
import {
  claimSegmentGeneration,
  finalizeSegmentReady,
  findSegmentByIdentity,
  type SegmentRow,
  waitForSegmentReady,
} from '@/domains/reader-audio/repository';
import { readerAudioRoutes } from '@/domains/reader-audio/routes';
import { getReaderAudioSegment, streamReaderAudioSegment } from '@/domains/reader-audio/service';
import { synthesizeReaderAudioSegment } from '@/domains/reader-audio/synthesis';
import { getObjectStream, putObject } from '@/infra/storage';

vi.mock('@/domains/reader-audio/config', () => ({ resolveReaderAudioConfig: vi.fn() }));
vi.mock('@/domains/reader-audio/repository', () => ({
  claimSegmentGeneration: vi.fn(),
  finalizeSegmentReady: vi.fn(),
  failSegmentGeneration: vi.fn(),
  findSegmentByIdentity: vi.fn(),
  waitForSegmentReady: vi.fn(),
  MAX_CLAIM_RETRIES: 2,
}));
vi.mock('@/domains/reader-audio/synthesis', () => ({ synthesizeReaderAudioSegment: vi.fn() }));
vi.mock('@/domains/works/access', () => ({
  requireReadablePart: vi.fn(async () => ({ body: '<p data-p="0">Hello world.</p>', workId: 'work' })),
  workReadActorFromIdentity: () => ({ userId: 'user', role: 'authenticated' }),
}));
vi.mock('@/infra/storage', () => ({
  putObject: vi.fn(),
  getObjectStream: vi.fn(),
  getObjectSize: vi.fn(),
  RangeNotSatisfiableError: class extends Error {},
}));

const actor = { userId: 'user', role: 'authenticated' as const };
const config = {
  row: { provider: 'azure', region: 'eastus' },
  scopeKey: 'instance',
  ownerUserId: null,
  voice: 'voice-a',
} as ReaderAudioConfig;
const audio = (text: string) => ({
  audio: Buffer.from(text),
  voice: config.voice,
  mimeType: 'audio/mpeg',
  durationMs: text === 'winner' ? 200 : 100,
  wordTimings: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('reader audio publication and browser caching', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveReaderAudioConfig).mockResolvedValue(config);
  });

  it('keeps a late expired holder from overwriting the winner bytes or timings', async () => {
    const oldSynthesis = deferred<ReturnType<typeof audio>>();
    const started = deferred<void>();
    const objects = new Map<string, Buffer>();
    let published: SegmentRow | null = null;
    vi.mocked(findSegmentByIdentity).mockImplementation(async () => published);
    vi.mocked(claimSegmentGeneration)
      .mockResolvedValueOnce({ kind: 'claimed', id: 'row', token: 'old-token' })
      .mockResolvedValueOnce({ kind: 'claimed', id: 'row', token: 'winner-token' });
    vi.mocked(synthesizeReaderAudioSegment)
      .mockImplementationOnce(() => {
        started.resolve();
        return oldSynthesis.promise;
      })
      .mockResolvedValueOnce(audio('winner'));
    vi.mocked(putObject).mockImplementation(async ({ key, body }) => {
      objects.set(key, Buffer.from(body));
    });
    vi.mocked(finalizeSegmentReady).mockImplementation(async (_id, token, patch) => {
      if (token !== 'winner-token') return false;
      published = { ...patch, status: 'ready', scopeKey: 'instance', ownerUserId: null } as SegmentRow;
      return true;
    });
    vi.mocked(waitForSegmentReady).mockImplementation(async () => ({ kind: 'ready', row: published! }));
    vi.mocked(getObjectStream).mockImplementation(async (key) => ({
      stream: new Blob([new Uint8Array(objects.get(key)!)]).stream(),
      contentType: 'audio/mpeg',
      contentLength: objects.get(key)!.length,
      contentRange: null,
      etag: null,
    }));

    const oldRequest = getReaderAudioSegment(actor, 'part', 'us', 0);
    await started.promise;
    const winner = await getReaderAudioSegment(actor, 'part', 'us', 0);
    oldSynthesis.resolve(audio('old'));
    const oldResult = await oldRequest;
    expect(oldResult).toEqual(winner);
    expect(oldResult.durationMs).toBe(200);
    const streamed = await streamReaderAudioSegment(actor, 'part', 'us', 0, winner.segmentHash);
    expect(await new Response(streamed.stream).text()).toBe('winner');
    expect(objects.size).toBe(2);
    expect(new Set(vi.mocked(putObject).mock.calls.map(([input]) => input.key)).size).toBe(2);
    expect(synthesizeReaderAudioSegment).toHaveBeenCalledTimes(2);
  });

  it('serves the newly resolved voice without persistent browser caching and bypasses old immutable URLs', async () => {
    const identities: string[] = [];
    vi.mocked(findSegmentByIdentity).mockImplementation(async (identity) => {
      identities.push(identity.storageKey);
      return {
        status: 'ready',
        scopeKey: identity.scopeKey,
        ownerUserId: identity.ownerUserId,
        storageKey: identity.storageKey,
        voice: identity.configFingerprint,
        mimeType: 'audio/mpeg',
        durationMs: 100,
        wordTimings: [],
      } as unknown as SegmentRow;
    });
    vi.mocked(getObjectStream).mockImplementation(async (key) => ({
      stream: new Blob([key]).stream(),
      contentType: 'audio/mpeg',
      contentLength: null,
      contentRange: null,
      etag: null,
    }));
    const first = await getReaderAudioSegment(actor, 'part', 'us', 0);
    expect(new URL(first.audioUrl, 'http://localhost').searchParams.get('v')).toBe('2');
    const before = await readerAudioRoutes.request(first.audioUrl);
    expect(before.headers.get('cache-control')).toBe('private, no-store');
    const beforeBytes = await before.text();
    vi.mocked(resolveReaderAudioConfig).mockResolvedValue({ ...config, voice: 'voice-b' });
    const after = await readerAudioRoutes.request(first.audioUrl);
    expect(after.status).toBe(200);
    expect(after.headers.get('cache-control')).toBe('private, no-store');
    expect(await after.text()).not.toBe(beforeBytes);
    expect(identities[1]).not.toBe(identities[2]);
    expect(synthesizeReaderAudioSegment).not.toHaveBeenCalled();
  });

  it('does not cache partial responses either', async () => {
    vi.mocked(findSegmentByIdentity).mockResolvedValue({
      status: 'ready',
      scopeKey: 'instance',
      ownerUserId: null,
      storageKey: 'ready-object',
      voice: 'voice-a',
      mimeType: 'audio/mpeg',
      durationMs: 100,
      wordTimings: [],
    } as SegmentRow);
    vi.mocked(getObjectStream).mockResolvedValue({
      stream: new Blob(['a']).stream(),
      contentType: 'audio/mpeg',
      contentLength: 1,
      contentRange: 'bytes 0-0/3',
      etag: null,
    });
    const segment = await getReaderAudioSegment(actor, 'part', 'us', 0);
    const response = await readerAudioRoutes.request(segment.audioUrl, { headers: { Range: 'bytes=0-0' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(getObjectStream).toHaveBeenCalledWith('ready-object', { start: 0, end: 0 });
  });

  it('derives distinct claim objects while retaining the identity namespace', () => {
    const identity = buildReaderAudioIdentity({
      partId: 'part',
      role: 'us',
      scopeKey: 'instance',
      ownerUserId: null,
      provider: 'azure',
      region: 'eastus',
      voice: 'voice-a',
      segmentHash: 'hash',
    });
    const a = buildReaderAudioAttemptStorageKey(identity.storageKey, 'token-a');
    const b = buildReaderAudioAttemptStorageKey(identity.storageKey, 'token-b');
    expect(a).not.toBe(b);
    expect(a).toBe(identity.storageKey.replace(/\.mp3$/, '/token-a.mp3'));
  });
});
