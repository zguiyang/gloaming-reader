import { randomUUID } from 'node:crypto';

import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  type ContentAssetMeta,
  readingWork as readingWorkTable,
} from '@gloaming/db';

import { optimizeIngestImage } from '@/domains/ingest/parser/image-optimizer';
import { coverKey, sha256 } from '@/domains/ingest/parser/parse-artifacts';
import { db } from '@/infra/db';
import { assertSafeOutboundUrl } from '@/infra/llm/outbound-url';
import { rootLogger } from '@/infra/logging/logger';
import { putObject } from '@/infra/storage';

export const JOB_WORK_COVER_REFRESH = 'work-cover-refresh';

/** Wall-clock budget for one cover download, body streaming included. */
export const WORK_COVER_DOWNLOAD_TIMEOUT_MS = 10_000;

/** Hard byte cap for a source cover; larger responses fail without touching the stored cover. */
export const WORK_COVER_MAX_BYTES = 5 * 1024 * 1024;

const WORK_COVER_MAX_REDIRECTS = 5;

/** Short URL hash suffix of the deduplicating BullMQ job id (per-work, per-cover idempotence). */
const JOB_ID_HASH_LENGTH = 12;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type WorkCoverRefreshJobData = {
  workId: string;
  sourceCoverUrl: string;
};

export type WorkCoverRefreshSkipReason =
  'invalid_payload' | 'work_missing' | 'work_failed' | 'personal_work' | 'unchanged' | 'concurrent_update';

export type WorkCoverRefreshResult =
  | { ok: true; workId: string; outcome: 'updated'; sourceCoverUrl: string }
  | { ok: true; workId: string; outcome: 'skipped'; reason: WorkCoverRefreshSkipReason };

export type WorkCoverRefreshErrorCode =
  | 'unsafe_url'
  | 'redirect_unsafe'
  | 'redirect_limit'
  | 'http_error'
  | 'unexpected_content'
  | 'too_large'
  | 'timeout'
  | 'network_error';

/**
 * Cover refresh failure. Every code is retryable by BullMQ (attempts: 2) and a
 * final failure leaves the previously stored cover untouched: nothing is
 * written to the database before the download and optimization succeed.
 */
export class WorkCoverRefreshError extends Error {
  readonly code: WorkCoverRefreshErrorCode;

  constructor(code: WorkCoverRefreshErrorCode, message: string) {
    super(message);
    this.name = 'WorkCoverRefreshError';
    this.code = code;
  }
}

/** `work-cover-refresh:<workId>:<short sha256 of the cover URL>` — same work + URL never queues twice. */
export function workCoverRefreshJobId(workId: string, sourceCoverUrl: string): string {
  const hash = sha256(Buffer.from(sourceCoverUrl, 'utf8')).slice(0, JOB_ID_HASH_LENGTH);
  return `${JOB_WORK_COVER_REFRESH}:${workId}:${hash}`;
}

/** `origin_meta.sourceCoverUrl` marker of the source cover already applied to a Work. */
export function sourceCoverUrlOf(work: { originMeta: Record<string, unknown> | null }): string | null {
  const value = work.originMeta?.sourceCoverUrl;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Host only — never the full URL — so logs stay free of query strings and credentials. */
export function coverUrlHost(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}

const coverLogger = rootLogger.child({ module: 'WorkCoverRefreshJob' });

/**
 * HTTPS-only plus the repository outbound URL guard (scheme, credentials,
 * private networks). A cover URL that fails here can never become safe, so it
 * surfaces as a job failure instead of silently keeping a stale marker.
 */
function assertSafeCoverUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new WorkCoverRefreshError('unsafe_url', 'the source cover URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new WorkCoverRefreshError('unsafe_url', 'the source cover URL must use HTTPS');
  }
  try {
    assertSafeOutboundUrl(rawUrl, 'source cover URL');
  } catch {
    throw new WorkCoverRefreshError('unsafe_url', 'the source cover URL targets a blocked network');
  }
}

type DownloadedCover = {
  bytes: Buffer;
  mime: string;
};

function toCoverError(error: unknown, timedOut: boolean): WorkCoverRefreshError {
  if (error instanceof WorkCoverRefreshError) {
    return error;
  }
  if (timedOut) {
    return new WorkCoverRefreshError('timeout', 'the source cover download exceeded its time budget');
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new WorkCoverRefreshError('timeout', 'the source cover download was aborted');
  }
  return new WorkCoverRefreshError('network_error', 'the source cover download could not be completed');
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/**
 * Bounded in-memory cover download: HTTPS-only with per-hop outbound safety on
 * redirects, `image/*` content type, and the 5 MB byte cap enforced on both the
 * declared length and the received bytes. Never returns partial bytes.
 */
async function downloadCover(url: string, timeoutMs: number): Promise<DownloadedCover> {
  assertSafeCoverUrl(url);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let currentUrl = url;
    let response: Response;
    try {
      for (let redirects = 0; ; redirects += 1) {
        response = await fetch(currentUrl, {
          method: 'GET',
          headers: { Accept: 'image/*' },
          redirect: 'manual',
          signal: controller.signal,
        });

        if (!REDIRECT_STATUSES.has(response.status)) {
          break;
        }

        const location = response.headers.get('location');
        await cancelBody(response);
        if (!location) {
          throw new WorkCoverRefreshError('redirect_unsafe', 'a cover redirect response had no Location header');
        }
        if (redirects >= WORK_COVER_MAX_REDIRECTS) {
          throw new WorkCoverRefreshError('redirect_limit', 'the source cover download exceeded its redirect limit');
        }
        const nextUrl = new URL(location, currentUrl).toString();
        assertSafeCoverUrl(nextUrl);
        currentUrl = nextUrl;
      }

      if (!response.ok) {
        const status = response.status;
        await cancelBody(response);
        throw new WorkCoverRefreshError('http_error', `the source cover download failed with HTTP status ${status}`);
      }

      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      if (!contentType.startsWith('image/')) {
        await cancelBody(response);
        throw new WorkCoverRefreshError(
          'unexpected_content',
          `the source cover download returned ${contentType || 'no content type'}`,
        );
      }

      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > WORK_COVER_MAX_BYTES) {
        await cancelBody(response);
        throw new WorkCoverRefreshError(
          'too_large',
          `the source cover exceeded the ${WORK_COVER_MAX_BYTES}-byte limit`,
        );
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > WORK_COVER_MAX_BYTES) {
        throw new WorkCoverRefreshError(
          'too_large',
          `the source cover exceeded the ${WORK_COVER_MAX_BYTES}-byte limit`,
        );
      }
      if (bytes.length === 0) {
        throw new WorkCoverRefreshError('unexpected_content', 'the source cover download returned an empty body');
      }

      return { bytes, mime: contentType };
    } catch (error) {
      throw toCoverError(error, timedOut);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Cover asset provenance plus the optimization detail already recorded by ingest. */
type WorkCoverAssetMeta = ContentAssetMeta & { sourceUrl: string };

/**
 * Applies the synchronized source cover onto an already-materialized Work
 * (product decision 2026-10-20).
 *
 * No-op when the Work is missing, failed, personal (`owner_user_id` set), or
 * already carries this exact source cover. Otherwise the cover is downloaded
 * outside the transaction (HTTPS, outbound-safe, 10 s, `image/*`, 5 MB) and
 * optimized with the ingest image pipeline; only then does one transaction
 * insert the new `content_asset` cover row, point `cover_asset_id` at it, merge
 * `origin_meta.sourceCoverUrl`, and drop the superseded cover row. Any failure
 * rethrows for the BullMQ retry (attempts: 2) and leaves the current cover in
 * place.
 */
export async function processWorkCoverRefresh(
  data: WorkCoverRefreshJobData,
  options: { timeoutMs?: number } = {},
): Promise<WorkCoverRefreshResult> {
  const workId = typeof data?.workId === 'string' ? data.workId : '';
  const sourceCoverUrl = typeof data?.sourceCoverUrl === 'string' ? data.sourceCoverUrl.trim() : '';
  const urlHost = sourceCoverUrl ? coverUrlHost(sourceCoverUrl) : null;

  if (!workId || !sourceCoverUrl) {
    coverLogger.warn(
      { workId: workId || null, urlHost, result: 'skipped', reason: 'invalid_payload' },
      'Work cover refresh skipped',
    );
    return { ok: true, workId, outcome: 'skipped', reason: 'invalid_payload' };
  }

  const skip = (reason: WorkCoverRefreshSkipReason): WorkCoverRefreshResult => {
    coverLogger.info({ workId, urlHost, result: 'skipped', reason }, 'Work cover refresh skipped');
    return { ok: true, workId, outcome: 'skipped', reason };
  };

  const [work] = await db
    .select({
      id: readingWorkTable.id,
      processingStatus: readingWorkTable.processingStatus,
      ownerUserId: readingWorkTable.ownerUserId,
      originMeta: readingWorkTable.originMeta,
    })
    .from(readingWorkTable)
    .where(eq(readingWorkTable.id, workId))
    .limit(1);

  if (!work) return skip('work_missing');
  if (work.processingStatus === 'failed') return skip('work_failed');
  if (work.ownerUserId !== null) return skip('personal_work');
  if (sourceCoverUrlOf(work) === sourceCoverUrl) return skip('unchanged');

  const timeoutMs = options.timeoutMs ?? WORK_COVER_DOWNLOAD_TIMEOUT_MS;
  const downloaded = await downloadCover(sourceCoverUrl, timeoutMs);
  const sourceHash = sha256(downloaded.bytes);
  const optimized = await optimizeIngestImage({ bytes: downloaded.bytes, mime: downloaded.mime });
  const attemptToken = randomUUID();
  const storageKey = coverKey(workId, attemptToken, sourceHash, optimized.mime);

  // Uploaded before the transaction: a rolled-back row leaves an unreferenced
  // object that the existing asset-cleanup job reclaims, never a broken row.
  await putObject({ key: storageKey, body: optimized.bytes, contentType: optimized.mime });

  const coverAssetId = randomUUID();
  const meta: WorkCoverAssetMeta = {
    sourceUrl: sourceCoverUrl,
    size: optimized.finalByteLength,
    sourceMimeType: optimized.originalMime,
    sourceSize: optimized.originalByteLength,
    transform: optimized.transform,
    transformVersion: optimized.transformVersion,
  };

  const committed = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: readingWorkTable.id, originMeta: readingWorkTable.originMeta })
      .from(readingWorkTable)
      .where(
        and(
          eq(readingWorkTable.id, workId),
          isNull(readingWorkTable.ownerUserId),
          ne(readingWorkTable.processingStatus, 'failed'),
        ),
      )
      .for('update');
    // Missing, failed, personal, or already refreshed by a concurrent attempt.
    if (!locked) return 'ineligible';
    if (sourceCoverUrlOf(locked) === sourceCoverUrl) return 'unchanged';

    await tx.insert(contentAssetTable).values({
      id: coverAssetId,
      workId,
      kind: 'cover',
      storageKey,
      mimeType: optimized.mime,
      contentHash: sourceHash,
      meta,
      status: 'ready',
    });
    await tx
      .update(readingWorkTable)
      .set({
        coverAssetId,
        originMeta: sql`${readingWorkTable.originMeta} || ${JSON.stringify({ sourceCoverUrl })}::jsonb`,
      })
      .where(eq(readingWorkTable.id, workId));
    // Superseded cover rows go away in the same transaction; their objects are
    // reclaimed by the existing asset-cleanup job.
    await tx
      .delete(contentAssetTable)
      .where(
        and(
          eq(contentAssetTable.workId, workId),
          eq(contentAssetTable.kind, 'cover'),
          ne(contentAssetTable.id, coverAssetId),
        ),
      );

    return 'updated' as const;
  });

  if (committed !== 'updated') {
    return skip(committed === 'unchanged' ? 'unchanged' : 'concurrent_update');
  }

  coverLogger.info(
    { workId, urlHost, result: 'updated', coverAssetId, mimeType: optimized.mime },
    'Work cover refreshed',
  );
  return { ok: true, workId, outcome: 'updated', sourceCoverUrl };
}
