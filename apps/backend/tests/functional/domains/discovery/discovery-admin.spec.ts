import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { user as userTable } from '@gloaming/db';
import { discoverySource as discoverySourceTable } from '@gloaming/db/schema';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
import { discoverySourceStatusSchema, discoverySyncTriggerResultSchema } from '@gloaming/shared/discovery';

import app from '@/app';
import { JOB_DISCOVERY_SYNC } from '@/application/jobs/discovery-sync';
import { PROJECT_GUTENBERG_SOURCE_KEY } from '@/domains/discovery/gutenberg/constants';
import { db } from '@/infra/db';
import { closeQueue, getDiscoverySyncQueue, getQueueConnection } from '@/infra/queue';
import { HTTP_STATUS } from '@/shared/constants';
import { ERROR_CODES } from '@/shared/errors/codes';

const { sendAuthMailMock } = vi.hoisted(() => ({ sendAuthMailMock: vi.fn().mockResolvedValue(undefined) }));
const queueMocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  testQueue: null as unknown as { add: (...args: never[]) => Promise<{ id?: string }> },
}));

vi.mock('@/infra/auth/mail', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendAuthMail: sendAuthMailMock };
});

vi.mock('@/infra/queue', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown> & {
    enqueueDiscoverySync: (...args: never[]) => Promise<string>;
    getDiscoverySyncQueue: () => Queue;
  };
  return {
    ...actual,
    getDiscoverySyncQueue: () => queueMocks.testQueue ?? actual.getDiscoverySyncQueue(),
    enqueueDiscoverySync: queueMocks.enqueue,
  };
});

const password = 'password123';
const SOURCE_PATH = '/api/admin/discovery/sources/project-gutenberg';
const createdEmails: string[] = [];
let preExisting: typeof discoverySourceTable.$inferSelect | null = null;
const testStartedAt = Date.now();

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

async function removeDiscoverySyncJobs(): Promise<void> {
  const jobs = await getDiscoverySyncQueue().getJobs(
    ['waiting', 'delayed', 'paused', 'active', 'completed', 'failed'],
    0,
    100,
  );
  for (const job of jobs) {
    if (job.name !== JOB_DISCOVERY_SYNC) {
      continue;
    }
    if ((job.timestamp ?? 0) < testStartedAt) {
      continue;
    }
    await job.remove().catch(() => undefined);
  }
}

async function discoverySyncJobCount(): Promise<number> {
  const jobs = await getDiscoverySyncQueue().getJobs(
    ['waiting', 'delayed', 'paused', 'active', 'completed', 'failed'],
    0,
    100,
  );
  return jobs.filter((job) => job.name === JOB_DISCOVERY_SYNC && (job.timestamp ?? 0) >= testStartedAt).length;
}

/**
 * Full-range discovery-sync job count: `getJobs(..., 0, -1)` reads each state
 * end to end, unlike the windowed helpers above, so a job pushed past the
 * 0..100 page by newer jobs is still counted.
 */
async function discoverySyncJobCountFull(): Promise<number> {
  const jobs = await getDiscoverySyncQueue().getJobs(
    ['waiting', 'delayed', 'paused', 'active', 'completed', 'failed', 'prioritized'],
    0,
    -1,
  );
  return jobs.filter((job) => job.name === JOB_DISCOVERY_SYNC && (job.timestamp ?? 0) >= testStartedAt).length;
}

async function removeUniqueQueueKeys(queueName: string): Promise<void> {
  const keys = await getQueueConnection().keys(`bull:${queueName}:*`);
  if (keys.length) await getQueueConnection().del(...keys);
}

describe('Admin DiscoverySource controls', () => {
  let adminCookie = '';
  let userCookie = '';

  beforeAll(async () => {
    const [existing] = await db
      .select()
      .from(discoverySourceTable)
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY))
      .limit(1);
    preExisting = existing ?? null;

    // Start from a known, enabled, idle source; cleanup restores the prior row when one existed.
    await db
      .insert(discoverySourceTable)
      .values({ id: randomUUID(), sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, sourceType: 'gutenberg_rdf' })
      .onConflictDoNothing({ target: discoverySourceTable.sourceKey });
    await db
      .update(discoverySourceTable)
      .set({ enabled: true, syncStatus: 'idle', syncStartedAt: null, lastErrorSummary: null })
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));

    adminCookie = (await createSession('admin')).cookie;
    userCookie = (await createSession('user')).cookie;

    queueMocks.testQueue = new Queue(`gloaming-discovery-sync-admin-test-${randomUUID()}`, {
      connection: getQueueConnection(),
    }) as unknown as typeof queueMocks.testQueue;

    // All admin sync jobs are redirected to a unique test-only queue; failure tests override once.
    queueMocks.enqueue.mockImplementation(async (...args: never[]) => {
      const job = await queueMocks.testQueue.add(...args);
      if (!job.id) throw new Error('Test discovery sync job was added without an id');
      return job.id;
    });
  });

  afterAll(async () => {
    await removeDiscoverySyncJobs();
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
    if (preExisting) {
      await db
        .update(discoverySourceTable)
        .set({
          enabled: preExisting.enabled,
          syncStatus: preExisting.syncStatus,
          syncStartedAt: preExisting.syncStartedAt,
          syncFinishedAt: preExisting.syncFinishedAt,
          lastSuccessAt: preExisting.lastSuccessAt,
          lastErrorSummary: preExisting.lastErrorSummary,
          snapshotLastModified: preExisting.snapshotLastModified,
          snapshotVersion: preExisting.snapshotVersion,
          updatedAt: preExisting.updatedAt,
        })
        .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));
    } else {
      await db.delete(discoverySourceTable).where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));
    }
    const testQueue = queueMocks.testQueue as unknown as Queue;
    await testQueue.obliterate();
    await removeUniqueQueueKeys(testQueue.name);
    await testQueue.close();
    await closeQueue();
  });

  it('requires an administrator for status, toggle, and sync', async () => {
    expect((await app.request(SOURCE_PATH)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await app.request(SOURCE_PATH, { headers: { cookie: userCookie } })).status).toBe(HTTP_STATUS.FORBIDDEN);

    const anonPatch = await app.request(SOURCE_PATH, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(anonPatch.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await app.request(`${SOURCE_PATH}/sync`, { method: 'POST' })).status).toBe(HTTP_STATUS.UNAUTHORIZED);

    const patch = await app.request(SOURCE_PATH, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: userCookie },
      body: JSON.stringify({ enabled: false }),
    });
    expect(patch.status).toBe(HTTP_STATUS.FORBIDDEN);

    const sync = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: userCookie } });
    expect(sync.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('reports source status for an administrator', async () => {
    const response = await app.request(SOURCE_PATH, { headers: { cookie: adminCookie } });
    expect(response.status).toBe(HTTP_STATUS.OK);
    const status = discoverySourceStatusSchema.parse(await response.json());
    expect(status).toMatchObject({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, enabled: true, recordCount: 0 });
  });

  it('toggles the enabled flag and reflects it in status', async () => {
    const disable = await app.request(SOURCE_PATH, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disable.status).toBe(HTTP_STATUS.OK);
    expect(discoverySourceStatusSchema.parse(await disable.json()).enabled).toBe(false);

    const enable = await app.request(SOURCE_PATH, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enable.status).toBe(HTTP_STATUS.OK);
    expect(discoverySourceStatusSchema.parse(await enable.json()).enabled).toBe(true);

    const invalid = await app.request(SOURCE_PATH, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ enabled: 'yes' }),
    });
    expect(invalid.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('refuses to enqueue a sync for a disabled source', async () => {
    await db
      .update(discoverySourceTable)
      .set({ enabled: false })
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));

    const response = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(discoverySyncTriggerResultSchema.parse(await response.json())).toEqual({ result: 'disabled' });
    expect(await discoverySyncJobCount()).toBe(0);

    await db
      .update(discoverySourceTable)
      .set({ enabled: true })
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));
  });

  it('enqueues exactly one background sync and reports an already-running claim', async () => {
    const first = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
    expect(first.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(discoverySyncTriggerResultSchema.parse(await first.json())).toEqual({ result: 'queued' });

    const [row] = await db
      .select({ syncStatus: discoverySourceTable.syncStatus })
      .from(discoverySourceTable)
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY))
      .limit(1);
    expect(row?.syncStatus).toBe('queued');
    expect(await discoverySyncJobCount()).toBe(1);

    const second = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
    expect(second.status).toBe(HTTP_STATUS.OK);
    expect(discoverySyncTriggerResultSchema.parse(await second.json())).toEqual({ result: 'already_running' });
    expect(await discoverySyncJobCount()).toBe(1);
  });

  async function resetSourceToIdle(): Promise<void> {
    await removeDiscoverySyncJobs();
    await db
      .update(discoverySourceTable)
      .set({ enabled: true, syncStatus: 'idle', syncStartedAt: null, lastErrorSummary: null })
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));
  }

  it('never starts a scan for status reads or enable toggles', async () => {
    await resetSourceToIdle();

    const before = await discoverySyncJobCount();
    expect((await app.request(SOURCE_PATH, { headers: { cookie: adminCookie } })).status).toBe(HTTP_STATUS.OK);
    const toggle = await app.request(SOURCE_PATH, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ enabled: true }),
    });
    expect(toggle.status).toBe(HTTP_STATUS.OK);

    expect(await discoverySyncJobCount()).toBe(before);
    const [row] = await db
      .select({ syncStatus: discoverySourceTable.syncStatus })
      .from(discoverySourceTable)
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY))
      .limit(1);
    expect(row?.syncStatus).toBe('idle');
  });

  it('records a failed status and reports an error when enqueuing fails', async () => {
    await resetSourceToIdle();
    queueMocks.enqueue.mockImplementationOnce(async () => {
      throw new Error('redis connection refused');
    });

    const response = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
    expect(response.status).toBe(HTTP_STATUS.INTERNAL_ERROR);
    expect(await discoverySyncJobCount()).toBe(0);

    const [row] = await db
      .select()
      .from(discoverySourceTable)
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY))
      .limit(1);
    expect(row?.syncStatus).toBe('failed');
    expect(row?.lastErrorSummary).toBe('the Project Gutenberg metadata sync could not be queued');
  });

  it('recovers a stale queued claim as a timed-out failure without starting a scan', async () => {
    await resetSourceToIdle();
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'queued', syncStartedAt: null, updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));

    const before = await discoverySyncJobCount();
    const response = await app.request(SOURCE_PATH, { headers: { cookie: adminCookie } });
    expect(response.status).toBe(HTTP_STATUS.OK);
    const status = discoverySourceStatusSchema.parse(await response.json());
    expect(status.syncStatus).toBe('failed');
    expect(status.lastErrorSummary).toBe(
      'the Project Gutenberg metadata sync was queued but never started (timed out)',
    );
    expect(await discoverySyncJobCount()).toBe(before);
  });

  it('does not recover a stale queued claim while its queue job is still waiting', async () => {
    await resetSourceToIdle();

    const base = await discoverySyncJobCount();
    const first = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
    expect(first.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(discoverySyncTriggerResultSchema.parse(await first.json())).toEqual({ result: 'queued' });
    expect(await discoverySyncJobCount()).toBe(base + 1);

    // Backdate the claim far past the stale-queued age while its job still waits.
    await db
      .update(discoverySourceTable)
      .set({ updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));

    const whileWaiting = await app.request(SOURCE_PATH, { headers: { cookie: adminCookie } });
    expect(discoverySourceStatusSchema.parse(await whileWaiting.json()).syncStatus).toBe('queued');

    // Once the job is gone, the aged claim is recoverable as a timeout failure.
    await removeDiscoverySyncJobs();
    const afterRemoval = await app.request(SOURCE_PATH, { headers: { cookie: adminCookie } });
    const recovered = discoverySourceStatusSchema.parse(await afterRemoval.json());
    expect(recovered.syncStatus).toBe('failed');
    expect(recovered.lastErrorSummary).toBe(
      'the Project Gutenberg metadata sync was queued but never started (timed out)',
    );

    // Recovery alone starts no scan; a manual trigger re-queues exactly one job.
    const second = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
    expect(second.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(discoverySyncTriggerResultSchema.parse(await second.json())).toEqual({ result: 'queued' });
    expect(await discoverySyncJobCount()).toBe(base + 1);

    await resetSourceToIdle();
  });

  it('recovers a stale syncing run on the next manual trigger and re-queues once', async () => {
    await resetSourceToIdle();
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'syncing', syncStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));

    const before = await discoverySyncJobCount();
    const response = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
    expect(response.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(discoverySyncTriggerResultSchema.parse(await response.json())).toEqual({ result: 'queued' });
    expect(await discoverySyncJobCount()).toBe(before + 1);

    const [row] = await db
      .select()
      .from(discoverySourceTable)
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY))
      .limit(1);
    expect(row?.syncStatus).toBe('queued');
  });

  it('keeps a fresh queued claim and a live syncing run untouched', async () => {
    await resetSourceToIdle();

    const first = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
    expect(first.status).toBe(HTTP_STATUS.ACCEPTED);

    const readWhileQueued = await app.request(SOURCE_PATH, { headers: { cookie: adminCookie } });
    expect(discoverySourceStatusSchema.parse(await readWhileQueued.json()).syncStatus).toBe('queued');

    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'syncing', syncStartedAt: new Date() })
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));
    const readWhileSyncing = await app.request(SOURCE_PATH, { headers: { cookie: adminCookie } });
    expect(discoverySourceStatusSchema.parse(await readWhileSyncing.json()).syncStatus).toBe('syncing');

    const second = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
    expect(discoverySyncTriggerResultSchema.parse(await second.json())).toEqual({ result: 'already_running' });
  });

  it('keeps a queued claim live when newer jobs push its job out of the getJobs window', async () => {
    await resetSourceToIdle();
    const fillerPrefix = `test-filler-${Date.now()}`;
    const fillerIds: string[] = [];
    try {
      const first = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
      expect(first.status).toBe(HTTP_STATUS.ACCEPTED);
      expect(discoverySyncTriggerResultSchema.parse(await first.json())).toEqual({ result: 'queued' });
      expect(await discoverySyncJobCountFull()).toBe(1);

      // New jobs are LPUSHed to the head of the wait list, so 110 filler jobs
      // added after the claim's job push it past the getJobs(0..100) window.
      for (let i = 0; i < 110; i += 1) {
        const jobId = `${fillerPrefix}-${i}`;
        fillerIds.push(jobId);
        await getDiscoverySyncQueue().add('test-filler', { i }, { jobId });
      }

      // Age the queued claim past the stale threshold while its job still waits.
      await db
        .update(discoverySourceTable)
        .set({ updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
        .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));

      const status = await app.request(SOURCE_PATH, { headers: { cookie: adminCookie } });
      expect(discoverySourceStatusSchema.parse(await status.json()).syncStatus).toBe('queued');

      const second = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
      expect(second.status).toBe(HTTP_STATUS.OK);
      expect(discoverySyncTriggerResultSchema.parse(await second.json())).toEqual({ result: 'already_running' });
      expect(await discoverySyncJobCountFull()).toBe(1);
    } finally {
      // Only remove what this test created; never flush Redis.
      for (const jobId of fillerIds) {
        const job = await getDiscoverySyncQueue().getJob(jobId);
        if (job) {
          await job.remove().catch(() => undefined);
        }
      }
      await removeDiscoverySyncJobs();
      await resetSourceToIdle();
    }
  });

  it('keeps a queued claim live while the queue is paused', async () => {
    await resetSourceToIdle();
    try {
      await getDiscoverySyncQueue().pause();
      const first = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
      expect(first.status).toBe(HTTP_STATUS.ACCEPTED);
      expect(discoverySyncTriggerResultSchema.parse(await first.json())).toEqual({ result: 'queued' });

      await db
        .update(discoverySourceTable)
        .set({ updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
        .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));

      const status = await app.request(SOURCE_PATH, { headers: { cookie: adminCookie } });
      expect(discoverySourceStatusSchema.parse(await status.json()).syncStatus).toBe('queued');
    } finally {
      await getDiscoverySyncQueue().resume();
      await removeDiscoverySyncJobs();
      await resetSourceToIdle();
    }
  });

  it('derives a deterministic colon-free queue job id per claim token', async () => {
    const { discoverySyncJobId } = await import('@/domains/discovery/sync/admin');
    const claim = new Date(testStartedAt);
    const otherClaim = new Date(testStartedAt + 1);
    expect(discoverySyncJobId(PROJECT_GUTENBERG_SOURCE_KEY, claim)).toBe(
      discoverySyncJobId(PROJECT_GUTENBERG_SOURCE_KEY, claim),
    );
    expect(discoverySyncJobId(PROJECT_GUTENBERG_SOURCE_KEY, claim)).not.toBe(
      discoverySyncJobId(PROJECT_GUTENBERG_SOURCE_KEY, otherClaim),
    );
    expect(discoverySyncJobId(PROJECT_GUTENBERG_SOURCE_KEY, claim)).not.toContain(':');

    await resetSourceToIdle();
    try {
      const trigger = await app.request(`${SOURCE_PATH}/sync`, { method: 'POST', headers: { cookie: adminCookie } });
      expect(trigger.status).toBe(HTTP_STATUS.ACCEPTED);
      expect(discoverySyncTriggerResultSchema.parse(await trigger.json())).toEqual({ result: 'queued' });

      const [row] = await db
        .select({ syncStartedAt: discoverySourceTable.syncStartedAt })
        .from(discoverySourceTable)
        .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY))
        .limit(1);
      const claimedAt = row?.syncStartedAt;
      expect(claimedAt).toBeInstanceOf(Date);
      if (!claimedAt) {
        throw new Error('expected the queued claim to persist syncStartedAt');
      }
    } finally {
      await removeDiscoverySyncJobs();
      await resetSourceToIdle();
    }
  });

  it('enqueues force in the job data only for an explicit force body and rejects invalid bodies', async () => {
    const syncPath = `${SOURCE_PATH}/sync`;
    const jsonRequest = (body: unknown, cookie?: string) => ({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    const lastJobData = (): Record<string, unknown> => {
      const call = queueMocks.enqueue.mock.calls.at(-1);
      expect(call).toBeDefined();
      return call![1] as Record<string, unknown>;
    };

    try {
      queueMocks.enqueue.mockClear();

      // A force body never relaxes the admin authorization requirement.
      const anon = await app.request(syncPath, jsonRequest({ force: true }));
      expect(anon.status).toBe(HTTP_STATUS.UNAUTHORIZED);

      // Default trigger: the job data stays exactly as before force support.
      await resetSourceToIdle();
      const plain = await app.request(syncPath, { method: 'POST', headers: { cookie: adminCookie } });
      expect(plain.status).toBe(HTTP_STATUS.ACCEPTED);
      expect(lastJobData()).toEqual({
        sourceKey: PROJECT_GUTENBERG_SOURCE_KEY,
        claimedAt: expect.any(String),
      });

      // Explicit `force: true` is the only opt-in that reaches the job data.
      await resetSourceToIdle();
      const forced = await app.request(syncPath, jsonRequest({ force: true }, adminCookie));
      expect(forced.status).toBe(HTTP_STATUS.ACCEPTED);
      expect(lastJobData()).toEqual({
        sourceKey: PROJECT_GUTENBERG_SOURCE_KEY,
        claimedAt: expect.any(String),
        force: true,
      });

      // An explicit non-true flag is not an opt-in: the job data stays plain.
      await resetSourceToIdle();
      const notForced = await app.request(syncPath, jsonRequest({ force: false }, adminCookie));
      expect(notForced.status).toBe(HTTP_STATUS.ACCEPTED);
      expect(lastJobData()).not.toHaveProperty('force');

      // An invalid body fails with the validation contract and claims nothing.
      await resetSourceToIdle();
      queueMocks.enqueue.mockClear();
      const invalid = await app.request(syncPath, jsonRequest({ force: 'yes' }, adminCookie));
      expect(invalid.status).toBe(HTTP_STATUS.BAD_REQUEST);
      const errorBody = (await invalid.json()) as {
        error: string;
        code: string;
        details: { path: string; message: string; code: string }[];
      };
      expect(errorBody.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(errorBody.details).toEqual([
        { path: 'force', message: expect.any(String), code: ERROR_CODES.VALIDATION_INVALID_INPUT },
      ]);
      expect(queueMocks.enqueue).not.toHaveBeenCalled();
      const [idleRow] = await db
        .select({ syncStatus: discoverySourceTable.syncStatus })
        .from(discoverySourceTable)
        .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY))
        .limit(1);
      expect(idleRow?.syncStatus).toBe('idle');
    } finally {
      await removeDiscoverySyncJobs();
      await resetSourceToIdle();
    }
  });
});
