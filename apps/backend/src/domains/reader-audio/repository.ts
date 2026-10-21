import { randomUUID } from 'node:crypto';

import { and, eq, or, sql } from 'drizzle-orm';

import type { PartAudioSegmentWordTiming } from '@gloaming/db';
import { partAudioSegment as partAudioSegmentTable } from '@gloaming/db';

import type { ReaderAudioIdentity } from '@/domains/reader-audio/identity';
import { db } from '@/infra/db';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

export type SegmentRow = typeof partAudioSegmentTable.$inferSelect;

/** Claim lease — long enough for one ≤600-char Azure call, short enough for crash recovery. */
export const SEGMENT_LEASE_MS = 60_000;

/**
 * Wait budget for a waiter that lost the claim race. Must outlive the lease by
 * a margin: a slow-but-legal synthesis can consume the whole lease, and a
 * waiter must never fail (503) while the holder still has a valid claim.
 */
export const WAIT_TIMEOUT_MS = SEGMENT_LEASE_MS + 30_000;
const SEGMENT_WAIT_INTERVAL_MS = 150;

/** Max re-claim attempts after a wait ends without a ready row (bounded, no infinite loop). */
export const MAX_CLAIM_RETRIES = 2;

export type SegmentClaimMeta = {
  segmentIndex: number;
  segmentKey: string;
  paragraphAnchor: string;
  paragraphTextOffset: number;
  textLength: number;
  voice: string;
};

export type SegmentClaim =
  { kind: 'claimed'; id: string; token: string } | { kind: 'ready'; row: SegmentRow } | { kind: 'wait' };

/**
 * Wait outcome: `ready` serves directly; `retry` means the waiter should
 * re-claim (take over a failed row or an expired lease) instead of waiting on.
 */
export type SegmentWaitResult = { kind: 'ready'; row: SegmentRow } | { kind: 'retry' };

function identityWhere(identity: ReaderAudioIdentity) {
  return and(
    eq(partAudioSegmentTable.partId, identity.partId),
    eq(partAudioSegmentTable.role, identity.role),
    eq(partAudioSegmentTable.scopeKey, identity.scopeKey),
    eq(partAudioSegmentTable.configFingerprint, identity.configFingerprint),
    eq(partAudioSegmentTable.segmentHash, identity.segmentHash),
  )!;
}

export async function findSegmentByIdentity(identity: ReaderAudioIdentity): Promise<SegmentRow | null> {
  const [row] = await db.select().from(partAudioSegmentTable).where(identityWhere(identity)).limit(1);
  return row ?? null;
}

/**
 * Lease single-flight for one segment identity. Exactly one concurrent caller
 * gets `claimed`; others observe `ready` or `wait` and never call the provider.
 * All mutations run inside a transaction; takeover is a conditional update so
 * two requesters can never both hold a valid token.
 */
export async function claimSegmentGeneration(
  identity: ReaderAudioIdentity,
  meta: SegmentClaimMeta,
): Promise<SegmentClaim> {
  return db.transaction(async (tx): Promise<SegmentClaim> => {
    const token = randomUUID();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + SEGMENT_LEASE_MS);

    const inserted = await tx
      .insert(partAudioSegmentTable)
      .values({
        id: randomUUID(),
        partId: identity.partId,
        role: identity.role,
        scopeKey: identity.scopeKey,
        ownerUserId: identity.ownerUserId,
        configFingerprint: identity.configFingerprint,
        segmentIndex: meta.segmentIndex,
        segmentKey: meta.segmentKey,
        segmentHash: identity.segmentHash,
        paragraphAnchor: meta.paragraphAnchor,
        paragraphTextOffset: meta.paragraphTextOffset,
        textLength: meta.textLength,
        voice: meta.voice,
        mimeType: 'audio/mpeg',
        storageKey: identity.storageKey,
        status: 'generating',
        generationToken: token,
        leaseExpiresAt,
      })
      .onConflictDoNothing({
        target: [
          partAudioSegmentTable.partId,
          partAudioSegmentTable.role,
          partAudioSegmentTable.scopeKey,
          partAudioSegmentTable.configFingerprint,
          partAudioSegmentTable.segmentHash,
        ],
      })
      .returning({ id: partAudioSegmentTable.id });
    if (inserted[0]) {
      return { kind: 'claimed', id: inserted[0].id, token };
    }

    const [existing] = await tx.select().from(partAudioSegmentTable).where(identityWhere(identity)).limit(1);
    if (!existing) {
      // Row vanished between conflict and read (concurrent cleanup) — retry via caller.
      throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.UNAVAILABLE);
    }
    if (existing.status === 'ready') {
      return { kind: 'ready', row: existing };
    }
    if (existing.status === 'generating' && existing.leaseExpiresAt && existing.leaseExpiresAt > now) {
      return { kind: 'wait' };
    }

    // failed, or generating with an expired lease — take over only if still claimable.
    // NOTE: the lease comparison must use the same serialization convention as every
    // drizzle-written lease value (`.set/.values` store Dates as UTC ISO strings, and
    // `timestamp` columns silently drop offsets). Passing a raw Date here would make
    // the driver send local wall time and let a non-UTC client take over a valid lease.
    const taken = await tx
      .update(partAudioSegmentTable)
      .set({
        generationToken: token,
        leaseExpiresAt,
        status: 'generating',
        errorCode: null,
      })
      .where(
        and(
          eq(partAudioSegmentTable.id, existing.id),
          or(
            eq(partAudioSegmentTable.status, 'failed'),
            and(
              eq(partAudioSegmentTable.status, 'generating'),
              sql`${partAudioSegmentTable.leaseExpiresAt} < ${now.toISOString()}`,
            ),
          ),
        ),
      )
      .returning({ id: partAudioSegmentTable.id });
    if (taken[0]) {
      return { kind: 'claimed', id: taken[0].id, token };
    }

    const [reread] = await tx.select().from(partAudioSegmentTable).where(identityWhere(identity)).limit(1);
    if (reread?.status === 'ready') {
      return { kind: 'ready', row: reread };
    }
    return { kind: 'wait' };
  });
}

/** Publish a claimed segment. Returns false when the token is stale (lease was taken over). */
export async function finalizeSegmentReady(
  id: string,
  token: string,
  patch: {
    storageKey: string;
    voice: string;
    mimeType: string;
    durationMs: number | null;
    wordTimings: PartAudioSegmentWordTiming[];
  },
): Promise<boolean> {
  const updated = await db
    .update(partAudioSegmentTable)
    .set({
      status: 'ready',
      generationToken: null,
      leaseExpiresAt: null,
      errorCode: null,
      storageKey: patch.storageKey,
      voice: patch.voice,
      mimeType: patch.mimeType,
      durationMs: patch.durationMs,
      wordTimings: patch.wordTimings,
    })
    .where(
      and(
        eq(partAudioSegmentTable.id, id),
        eq(partAudioSegmentTable.generationToken, token),
        eq(partAudioSegmentTable.status, 'generating'),
      ),
    )
    .returning({ id: partAudioSegmentTable.id });
  return updated.length > 0;
}

/** Mark a claimed segment failed so a later request can take the lease over. */
export async function failSegmentGeneration(id: string, token: string, errorCode: string): Promise<boolean> {
  const updated = await db
    .update(partAudioSegmentTable)
    .set({
      status: 'failed',
      generationToken: null,
      leaseExpiresAt: null,
      errorCode,
    })
    .where(
      and(
        eq(partAudioSegmentTable.id, id),
        eq(partAudioSegmentTable.generationToken, token),
        eq(partAudioSegmentTable.status, 'generating'),
      ),
    )
    .returning({ id: partAudioSegmentTable.id });
  return updated.length > 0;
}

/**
 * Poll until the segment is ready. Returns `retry` when the row failed, the
 * holder's lease expired (takeover needed), or the wait budget ran out — the
 * caller decides whether to re-claim. Never triggers synthesis itself.
 */
export async function waitForSegmentReady(
  identity: ReaderAudioIdentity,
  timeoutMs = WAIT_TIMEOUT_MS,
  intervalMs = SEGMENT_WAIT_INTERVAL_MS,
): Promise<SegmentWaitResult> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await findSegmentByIdentity(identity);
    if (row?.status === 'ready') {
      return { kind: 'ready', row };
    }
    if (row?.status === 'failed') {
      return { kind: 'retry' };
    }
    if (row?.status === 'generating' && row.leaseExpiresAt && row.leaseExpiresAt <= new Date()) {
      // Holder crashed or overran its lease — do not keep idling, let the caller take over.
      return { kind: 'retry' };
    }
    if (Date.now() >= deadline) {
      return { kind: 'retry' };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
