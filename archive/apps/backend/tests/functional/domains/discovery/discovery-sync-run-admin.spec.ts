import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { user as userTable } from '@gloaming/db';
import {
  discoverySource as discoverySourceTable,
  discoverySyncRun as discoverySyncRunTable,
} from '@gloaming/db/schema';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
import {
  discoverySourceStatusSchema,
  discoverySyncConsumerStateSchema,
  discoverySyncRunHistorySchema,
} from '@gloaming/shared/discovery';

import app from '@/app';
import { PROJECT_GUTENBERG_SOURCE_KEY } from '@/domains/discovery/gutenberg/constants';
import { requestProjectGutenbergSync } from '@/domains/discovery/sync/admin';
import type * as SyncRepository from '@/domains/discovery/sync/repository';
import {
  claimSourceQueued,
  createDiscoverySyncRun,
  ensureDiscoverySource,
  getLatestDiscoverySyncRun,
} from '@/domains/discovery/sync/repository';
import { db } from '@/infra/db';
import { closeQueue } from '@/infra/queue';
import { HTTP_STATUS } from '@/shared/constants';

/**
 * The admin endpoints resolve their source by the stable project_gutenberg key,
 * so this run redirects that key to a run-owned random fixture source and
 * deletes only it afterwards (same pattern as the observability spec): the test
 * never writes or force-resets the stable global source row.
 */
const fixtureSourceKey = vi.hoisted(() => `sync_run_admin_${crypto.randomUUID()}`);

vi.mock('@/domains/discovery/sync/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof SyncRepository>();
  const { PROJECT_GUTENBERG_SOURCE_KEY: STABLE_KEY } = await import('@/domains/discovery/gutenberg/constants');
  return {
    ...actual,
    ensureDiscoverySource: (sourceKey: string, sourceType: string) =>
      actual.ensureDiscoverySource(sourceKey === STABLE_KEY ? fixtureSourceKey : sourceKey, sourceType),
  };
});

const { sendAuthMailMock } = vi.hoisted(() => ({ sendAuthMailMock: vi.fn().mockResolvedValue(undefined) }));
const { enqueueDiscoverySyncMock } = vi.hoisted(() => ({ enqueueDiscoverySyncMock: vi.fn() }));

vi.mock('@/infra/queue', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, enqueueDiscoverySync: enqueueDiscoverySyncMock };
});

vi.mock('@/infra/auth/mail', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendAuthMail: sendAuthMailMock };
});

const password = 'password123';
const SOURCE_PATH = '/api/admin/discovery/sources/project-gutenberg';
const RUNS_PATH = `${SOURCE_PATH}/sync/runs`;
const createdEmails: string[] = [];

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) {
    return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
  }
  const single = response.headers.get('set-cookie');
  return single ? single.split(';')[0]! : '';
}

async function createSession(role: 'user' | 'admin') {
  const email = uniqueEmail(role);
  const username = `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const signUp = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password, name: role, username }),
  });
  expect(signUp.status).toBe(HTTP_STATUS.OK);
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
  if (role === 'admin') {
    await db.update(userTable).set({ role: AUTH_ADMIN_ROLE }).where(eq(userTable.email, email));
  }
  const login = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(HTTP_STATUS.OK);
  createdEmails.push(email);
  return { email, cookie: cookieHeader(login) };
}

describe('Admin discovery sync run observability endpoints', () => {
  let adminCookie = '';
  let userCookie = '';
  let sourceId = '';
  let stableBefore: Awaited<ReturnType<typeof readStableSourceState>> | null = null;

  /** Reads the real stable source directly, bypassing the redirected helper. */
  async function readStableSourceState() {
    const [row] = await db
      .select()
      .from(discoverySourceTable)
      .where(eq(discoverySourceTable.sourceKey, 'project_gutenberg'))
      .limit(1);
    const runs = row
      ? await db.select().from(discoverySyncRunTable).where(eq(discoverySyncRunTable.sourceId, row.id))
      : [];
    return { source: row ?? null, runs };
  }

  beforeAll(async () => {
    stableBefore = await readStableSourceState();
    const source = await ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, 'gutenberg_rdf');
    sourceId = source.id;
    adminCookie = (await createSession('admin')).cookie;
    userCookie = (await createSession('user')).cookie;
  });

  afterAll(async () => {
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
    // Remove only this run's owned fixture source (runs cascade with it); the
    // stable global source is never touched.
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    await closeQueue();
  });

  it('requires an administrator for the run history endpoint', async () => {
    expect((await app.request(RUNS_PATH)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await app.request(RUNS_PATH, { headers: { cookie: userCookie } })).status).toBe(HTTP_STATUS.FORBIDDEN);
    expect((await app.request(RUNS_PATH, { headers: { cookie: adminCookie } })).status).toBe(HTTP_STATUS.OK);
  });

  it('embeds current-run progress in the status response', async () => {
    const response = await app.request(SOURCE_PATH, { headers: { cookie: adminCookie } });
    expect(response.status).toBe(HTTP_STATUS.OK);
    const status = discoverySourceStatusSchema.parse(await response.json());
    expect(status.currentRun).toHaveProperty('run');
    expect(discoverySyncConsumerStateSchema.safeParse(status.currentRun.consumer).success).toBe(true);
  });

  it('reports a queued run with truthful consumer evidence (never a fabricated worker claim)', async () => {
    const claimedAt = await claimSourceQueued(sourceId);
    expect(claimedAt).not.toBeNull();
    await createDiscoverySyncRun({ sourceId, claimToken: claimedAt!, now: new Date() });

    const status = discoverySourceStatusSchema.parse(
      await (await app.request(SOURCE_PATH, { headers: { cookie: adminCookie } })).json(),
    );
    expect(status.syncStatus).toBe('queued');
    expect(status.currentRun.run).toMatchObject({ stage: 'queued', committedRecords: 0, committedBatches: 0 });
    // The admin test process runs no dedicated-queue worker, so a queued claim is
    // reported as lacking a consumer — conservatively, distinct from `unknown`.
    expect(status.currentRun.consumer).toBe('unavailable');

    // Restore an idle source for later tests (removes the claim without a scan).
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'idle', syncStartedAt: null })
      .where(eq(discoverySourceTable.id, sourceId));
  });

  it('returns the bounded run history list for an administrator', async () => {
    const response = await app.request(RUNS_PATH, { headers: { cookie: adminCookie } });
    expect(response.status).toBe(HTTP_STATUS.OK);
    const history = discoverySyncRunHistorySchema.parse(await response.json());
    expect(history.runs.length).toBeLessThanOrEqual(20);
    // Claims recorded before run tracking existed have no fabricated rows.
    for (const run of history.runs) {
      expect(run).not.toHaveProperty('totalRecords');
    }
  });

  it('fails both the source and the run when the sync job cannot be enqueued', async () => {
    await db
      .update(discoverySourceTable)
      .set({ enabled: true, syncStatus: 'idle', syncStartedAt: null, lastErrorSummary: null })
      .where(eq(discoverySourceTable.id, sourceId));
    enqueueDiscoverySyncMock.mockRejectedValueOnce(new Error('broker unreachable'));

    await expect(requestProjectGutenbergSync()).rejects.toThrow(
      'Failed to enqueue the Project Gutenberg metadata sync',
    );

    // The enqueue failure closed both the source row and its run in one
    // transaction, without any fabricated history.
    const source = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    expect(source[0]).toMatchObject({ syncStatus: 'failed' });
    const run = await getLatestDiscoverySyncRun(sourceId);
    expect(run).toMatchObject({
      stage: 'failed',
      errorSummary: 'the Project Gutenberg metadata sync could not be queued',
    });

    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'idle', syncStartedAt: null, lastErrorSummary: null })
      .where(eq(discoverySourceTable.id, sourceId));
  });

  it('never writes or force-resets the stable project_gutenberg source', async () => {
    // Runs after every other test: all endpoint and service calls resolve to the
    // random fixture source (via the repository redirect), so the real stable
    // source row and its runs must be identical to the beforeAll snapshot.
    const after = await readStableSourceState();
    expect(after).toEqual(stableBefore);
  });
});
