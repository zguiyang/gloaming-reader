import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { aiInvocationLog as aiInvocationLogTable, user as userTable } from '@gloaming/db';
import {
  AI_INVOCATION_DEFAULT_PAGE_SIZE,
  AI_INVOCATION_STATS_DAYS,
  type AiInvocationListData,
  type AiInvocationStats,
} from '@gloaming/shared/ai-invocations';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';

const password = 'password123';

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

async function signUp(input: { email: string; username: string; name: string }) {
  return app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({
      email: input.email,
      password,
      name: input.name,
      username: input.username,
    }),
  });
}

async function markEmailVerified(email: string) {
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
}

async function setUserRole(email: string, role: string) {
  await db.update(userTable).set({ role }).where(eq(userTable.email, email));
}

async function signInEmail(email: string) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
}

async function createSession(role: 'user' | 'admin' = 'user') {
  const email = uniqueEmail(role);
  const username = `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  expect((await signUp({ email, username, name: role })).status).toBe(200);
  await markEmailVerified(email);
  if (role === 'admin') {
    await setUserRole(email, AUTH_ADMIN_ROLE);
  }
  const login = await signInEmail(email);
  expect(login.status).toBe(200);
  return { email, cookie: cookieHeader(login) };
}

describe('Admin AI invocation logs HTTP', () => {
  const createdEmails: string[] = [];
  const createdLogIds: string[] = [];

  afterAll(async () => {
    if (createdLogIds.length > 0) {
      await db.delete(aiInvocationLogTable).where(inArray(aiInvocationLogTable.id, createdLogIds));
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('rejects anonymous and non-admin readers', async () => {
    const anonymous = await app.request('/api/admin/ai/invocations');
    expect(anonymous.status).toBe(HTTP_STATUS.UNAUTHORIZED);

    const user = await createSession('user');
    createdEmails.push(user.email);
    const forbidden = await app.request('/api/admin/ai/invocations', {
      headers: { cookie: user.cookie },
    });
    expect(forbidden.status).toBe(HTTP_STATUS.FORBIDDEN);

    const statsAnon = await app.request('/api/admin/ai/invocations/stats');
    expect(statsAnon.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('lists newest first at 20 per page and returns drawer fields', async () => {
    const admin = await createSession('admin');
    createdEmails.push(admin.email);

    const olderId = randomUUID();
    const newerId = randomUUID();
    const now = Date.now();
    createdLogIds.push(olderId, newerId);

    await db.insert(aiInvocationLogTable).values([
      {
        id: olderId,
        createdAt: new Date(now + 60_000),
        status: 'failure',
        errorCode: '503',
        errorMessage: 'upstream timeout',
        purpose: 'assist',
        source: 'assist.ask',
        modelId: 'gpt-4.1-mini',
        inputTokens: 1,
        outputTokens: 0,
        totalTokens: 1,
        costAmount: null,
        requestSummary: { actionId: 'gist', messageCount: 2 },
        responseSummary: null,
      },
      {
        id: newerId,
        createdAt: new Date(now + 120_000),
        status: 'success',
        purpose: 'assist',
        source: 'assist.ask.followups',
        modelId: 'gpt-4.1-mini',
        latencyMs: 88,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        costAmount: null,
        requestSummary: { actionId: 'gist', phase: 'followups' },
        responseSummary: { replyPreview: 'next questions', replyLength: 14 },
      },
    ]);

    const from = new Date(now - 1_000).toISOString();
    const to = new Date(now + 180_000).toISOString();
    const list = await app.request(
      `/api/admin/ai/invocations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {
        headers: { cookie: admin.cookie },
      },
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as AiInvocationListData;
    expect(body.pagination.pageSize).toBe(AI_INVOCATION_DEFAULT_PAGE_SIZE);
    expect(body.pagination.sortBy).toBe('createdAt');
    expect(body.items[0]?.id).toBe(newerId);
    expect(body.items[0]?.source).toBe('assist.ask.followups');
    expect(body.items[0]?.purpose).toBe('assist');
    expect(body.items[0]?.inputTokens).toBe(10);
    expect(body.items[0]?.outputTokens).toBe(5);
    expect(body.items[0]?.totalTokens).toBe(15);
    expect(body.items[0]?.responseSummary?.replyPreview).toBe('next questions');

    const page = await app.request(
      `/api/admin/ai/invocations?page=1&pageSize=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {
        headers: { cookie: admin.cookie },
      },
    );
    expect(page.status).toBe(200);
    const pageBody = (await page.json()) as AiInvocationListData;
    expect(pageBody.items).toHaveLength(1);
    expect(pageBody.items[0]?.id).toBe(newerId);
    expect(pageBody.pagination.pageSize).toBe(1);
  });

  it('sums tokens in the last 30 days and reports cost as 0', async () => {
    const admin = await createSession('admin');
    createdEmails.push(admin.email);

    const beforeRes = await app.request('/api/admin/ai/invocations/stats', {
      headers: { cookie: admin.cookie },
    });
    expect(beforeRes.status).toBe(200);
    const before = (await beforeRes.json()) as AiInvocationStats;

    const recentId = randomUUID();
    const staleId = randomUUID();
    createdLogIds.push(recentId, staleId);

    await db.insert(aiInvocationLogTable).values([
      {
        id: recentId,
        createdAt: new Date(),
        status: 'success',
        purpose: 'assist',
        source: 'admin.provider_test',
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
      },
      {
        id: staleId,
        createdAt: new Date(Date.now() - (AI_INVOCATION_STATS_DAYS + 2) * 24 * 60 * 60 * 1000),
        status: 'success',
        purpose: 'assist',
        source: 'assist.ask',
        inputTokens: 9_000,
        outputTokens: 9_000,
        totalTokens: 18_000,
      },
    ]);

    const afterRes = await app.request('/api/admin/ai/invocations/stats', {
      headers: { cookie: admin.cookie },
    });
    expect(afterRes.status).toBe(200);
    const after = (await afterRes.json()) as AiInvocationStats;
    expect(after.inputTokens).toBe(before.inputTokens + 100);
    expect(after.outputTokens).toBe(before.outputTokens + 40);
    expect(after.totalTokens).toBe(before.totalTokens + 140);
    expect(after.costAmount).toBe(0);
    expect(after.costCurrency).toBeNull();
  });

  it('filters by status and custom window, and rejects a reversed range', async () => {
    const admin = await createSession('admin');
    createdEmails.push(admin.email);

    const now = Date.now();
    const successId = randomUUID();
    const failureId = randomUUID();
    const outsideId = randomUUID();
    createdLogIds.push(successId, failureId, outsideId);

    await db.insert(aiInvocationLogTable).values([
      {
        id: successId,
        createdAt: new Date(now - 60_000),
        status: 'success',
        purpose: 'assist',
        source: 'assist.ask',
        inputTokens: 8,
        outputTokens: 2,
        totalTokens: 10,
      },
      {
        id: failureId,
        createdAt: new Date(now - 30_000),
        status: 'failure',
        purpose: 'assist',
        source: 'assist.ask',
        inputTokens: 3,
        outputTokens: 0,
        totalTokens: 3,
      },
      {
        id: outsideId,
        createdAt: new Date(now - 4 * 24 * 60 * 60 * 1000),
        status: 'failure',
        purpose: 'assist',
        source: 'assist.ask',
        inputTokens: 50,
        outputTokens: 10,
        totalTokens: 60,
      },
    ]);

    const from = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const to = new Date(now).toISOString();
    const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=failure`;

    const list = await app.request(`/api/admin/ai/invocations?${qs}&pageSize=50`, {
      headers: { cookie: admin.cookie },
    });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as AiInvocationListData;
    const ids = listBody.items.map((item) => item.id);
    expect(ids).toContain(failureId);
    expect(ids).not.toContain(successId);
    expect(ids).not.toContain(outsideId);

    const stats = await app.request(`/api/admin/ai/invocations/stats?${qs}`, {
      headers: { cookie: admin.cookie },
    });
    expect(stats.status).toBe(200);
    const statsBody = (await stats.json()) as AiInvocationStats;
    expect(statsBody.inputTokens).toBeGreaterThanOrEqual(3);
    expect(statsBody.totalTokens).toBeGreaterThanOrEqual(3);

    const reversed = await app.request(
      `/api/admin/ai/invocations?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`,
      { headers: { cookie: admin.cookie } },
    );
    expect(reversed.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('defaults the list to the last 30 days', async () => {
    const admin = await createSession('admin');
    createdEmails.push(admin.email);

    const recentId = randomUUID();
    const staleId = randomUUID();
    createdLogIds.push(recentId, staleId);

    await db.insert(aiInvocationLogTable).values([
      {
        id: recentId,
        createdAt: new Date(),
        status: 'success',
        purpose: 'assist',
        source: 'assist.ask',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
      {
        id: staleId,
        createdAt: new Date(Date.now() - (AI_INVOCATION_STATS_DAYS + 2) * 24 * 60 * 60 * 1000),
        status: 'success',
        purpose: 'assist',
        source: 'assist.ask',
        inputTokens: 20,
        outputTokens: 20,
        totalTokens: 40,
      },
    ]);

    const list = await app.request('/api/admin/ai/invocations?pageSize=50', {
      headers: { cookie: admin.cookie },
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as AiInvocationListData;
    const ids = body.items.map((item) => item.id);
    expect(ids).toContain(recentId);
    expect(ids).not.toContain(staleId);
  });
});
