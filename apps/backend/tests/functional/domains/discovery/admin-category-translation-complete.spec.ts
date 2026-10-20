import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { user as userTable } from '@gloaming/db';
import { publicCategoryLabel as publicCategoryLabelTable } from '@gloaming/db/schema';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/infra/db';
import { HTTP_STATUS } from '@/shared/constants';
import { ERROR_CODES } from '@/shared/errors/codes';

const { invokeAiMock, instanceProviderMock, acquireLockMock, sendAuthMailMock } = vi.hoisted(() => ({
  invokeAiMock: vi.fn(),
  instanceProviderMock: vi.fn(),
  acquireLockMock: vi.fn(),
  sendAuthMailMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/ai', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, invokeAi: invokeAiMock };
});

vi.mock('@/domains/provider-scope', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, resolveInstanceAppSettingValue: instanceProviderMock };
});

vi.mock('@/infra/cache/lock', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    acquireLock: (...args: unknown[]) => acquireLockMock(...args),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    startLockRenewal: vi.fn(() => ({ stop: vi.fn() })),
  };
});

vi.mock('@/infra/auth/mail', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendAuthMail: sendAuthMailMock };
});

const password = 'password123';
const CATEGORIES_PATH = '/api/admin/discovery/categories';
const createdEmails: string[] = [];
const createdCategoryIds: string[] = [];

function completePath(categoryId: string): string {
  return `${CATEGORIES_PATH}/${categoryId}/translations/complete`;
}

function aiResult<T>(content: T) {
  return {
    content,
    model: { rowId: 'mock', label: 'Mock', modelId: 'mock' },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  };
}

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
  return cookieHeader(login);
}

/** Manual create through the existing admin route; the model is never involved. */
async function createCategory(adminCookie: string, name: string, locale = 'en-US'): Promise<string> {
  const response = await app.request(CATEGORIES_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name, locale }),
  });
  expect(response.status).toBe(HTTP_STATUS.CREATED);
  const body = (await response.json()) as { id: string };
  createdCategoryIds.push(body.id);
  return body.id;
}

async function labelNames(categoryId: string): Promise<Record<string, { name: string; editedBy: string }>> {
  const rows = await db
    .select()
    .from(publicCategoryLabelTable)
    .where(eq(publicCategoryLabelTable.categoryId, categoryId));
  return Object.fromEntries(rows.map((row) => [row.locale, { name: row.name, editedBy: row.editedBy }]));
}

describe('Admin category translation completion endpoint on gloaming_test', () => {
  let adminCookie = '';
  let userCookie = '';

  beforeAll(async () => {
    adminCookie = await createSession('admin');
    userCookie = await createSession('user');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    acquireLockMock.mockResolvedValue(true);
    instanceProviderMock.mockResolvedValue('instance-model-row');
  });

  afterAll(async () => {
    for (const categoryId of createdCategoryIds) {
      await app.request(`${CATEGORIES_PATH}/${categoryId}`, { method: 'DELETE', headers: { cookie: adminCookie } });
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('requires an administrator', async () => {
    const path = completePath(randomUUID());
    expect((await app.request(path, { method: 'POST' })).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    const asUser = await app.request(path, { method: 'POST', headers: { cookie: userCookie } });
    expect(asUser.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(await invocations()).toBe(0);
  });

  it('fills only the missing locales and reports what it wrote', async () => {
    const categoryId = await createCategory(adminCookie, `Sci-Fi ${randomUUID().slice(0, 8)}`);
    invokeAiMock.mockResolvedValueOnce(aiResult({ translations: [{ locale: 'zh-CN', name: '科幻小说' }] }));

    const response = await app.request(completePath(categoryId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(await response.json()).toEqual({ translatedLocales: ['zh-CN'] });
    expect(await invocations()).toBe(1);

    const labels = await labelNames(categoryId);
    expect(labels['zh-CN']).toMatchObject({ name: '科幻小说', editedBy: 'ai' });
    // The manually created label is untouched and never sent as a write target.
    expect(labels['en-US']).toMatchObject({ editedBy: 'manual' });
    expect(labels['en-US'].name).not.toBe('科幻小说');

    const list = await app.request(CATEGORIES_PATH, { headers: { cookie: adminCookie } });
    const items = (await list.json()) as Array<{ id: string; missingLocales?: string[] }>;
    expect(items.find((item) => item.id === categoryId)?.missingLocales).toEqual([]);
  });

  it('never overwrites a manually edited locale while completing the other one', async () => {
    const manualName = `Manual ${randomUUID().slice(0, 8)}`;
    const categoryId = await createCategory(adminCookie, manualName);
    // The model answers for both locales; only the missing en-US target may be written.
    invokeAiMock.mockResolvedValueOnce(
      aiResult({
        translations: [
          { locale: 'en-US', name: 'Overwritten' },
          { locale: 'zh-CN', name: '覆盖测试' },
        ],
      }),
    );

    const response = await app.request(completePath(categoryId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(await response.json()).toEqual({ translatedLocales: ['zh-CN'] });
    const labels = await labelNames(categoryId);
    expect(labels['en-US']).toMatchObject({ name: manualName, editedBy: 'manual' });
    expect(labels['zh-CN']).toMatchObject({ name: '覆盖测试', editedBy: 'ai' });
  });

  it('is a no-op that skips the model when no locale is missing', async () => {
    const categoryId = await createCategory(adminCookie, 'Bilingual');
    const patch = await app.request(`${CATEGORIES_PATH}/${categoryId}/labels`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: '双语', locale: 'zh-CN' }),
    });
    expect(patch.status).toBe(HTTP_STATUS.OK);

    const response = await app.request(completePath(categoryId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(await response.json()).toEqual({ translatedLocales: [] });
    expect(await invocations()).toBe(0);
  });

  it('returns 404 for an unknown category', async () => {
    const response = await app.request(completePath(randomUUID()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    });
    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    expect((await response.json()).code).toBe(ERROR_CODES.NOT_FOUND.PUBLIC_CATEGORY);
    expect(await invocations()).toBe(0);
  });

  it('returns 503 when the instance model is unavailable and 409 while the lock is held', async () => {
    const categoryId = await createCategory(adminCookie, 'No Provider');
    instanceProviderMock.mockResolvedValue(null);
    const unavailable = await app.request(completePath(categoryId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    });
    expect(unavailable.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect((await unavailable.json()).code).toBe(ERROR_CODES.AI.UNAVAILABLE);

    instanceProviderMock.mockResolvedValue('instance-model-row');
    acquireLockMock.mockResolvedValueOnce(false);
    const busy = await app.request(completePath(categoryId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    });
    expect(busy.status).toBe(HTTP_STATUS.CONFLICT);
    expect((await busy.json()).code).toBe(ERROR_CODES.DISCOVERY.PUBLIC_CATEGORY_TRANSLATION_BUSY);
    expect(await invocations()).toBe(0);
  });
});

async function invocations(): Promise<number> {
  return invokeAiMock.mock.calls.length;
}
