import { randomUUID } from 'node:crypto';

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
import { closeQueue, getQueue } from '@/infra/queue';
import { HTTP_STATUS } from '@/shared/constants';

const { sendAuthMailMock } = vi.hoisted(() => ({ sendAuthMailMock: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/infra/auth/mail', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendAuthMail: sendAuthMailMock };
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
  const jobs = await getQueue().getJobs(['waiting', 'delayed', 'paused', 'active', 'completed', 'failed'], 0, 100);
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
  const jobs = await getQueue().getJobs(['waiting', 'delayed', 'paused', 'active', 'completed', 'failed'], 0, 100);
  return jobs.filter((job) => job.name === JOB_DISCOVERY_SYNC && (job.timestamp ?? 0) >= testStartedAt).length;
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
        })
        .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));
    } else {
      await db.delete(discoverySourceTable).where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY));
    }
    await closeQueue();
  });

  it('requires an administrator for status, toggle, and sync', async () => {
    expect((await app.request(SOURCE_PATH)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await app.request(SOURCE_PATH, { headers: { cookie: userCookie } })).status).toBe(HTTP_STATUS.FORBIDDEN);

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
});
