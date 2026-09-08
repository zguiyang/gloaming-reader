import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  conversation as conversationTable,
  conversationMessage as conversationMessageTable,
  user as userTable,
} from '@gloaming/db';
import type { ConversationDetail, ConversationListData, ConversationSummary } from '@gloaming/shared/conversations';

import app from '@/app';
import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import * as conversationsService from '@/modules/conversations/service';

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

async function signInEmail(email: string) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
}

async function createSession(prefix: string) {
  const email = uniqueEmail(prefix);
  const username = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  expect((await signUp({ email, username, name: prefix })).status).toBe(200);
  await markEmailVerified(email);
  const login = await signInEmail(email);
  expect(login.status).toBe(200);
  const me = await app.request('/api/me', { headers: { cookie: cookieHeader(login) } });
  expect(me.status).toBe(200);
  const user = (await me.json()) as { id: string };
  return { email, cookie: cookieHeader(login), userId: user.id };
}

describe('Conversations HTTP', () => {
  const createdEmails: string[] = [];
  const createdConversationIds: string[] = [];

  afterAll(async () => {
    if (createdConversationIds.length > 0) {
      await db.delete(conversationTable).where(inArray(conversationTable.id, createdConversationIds));
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('creates threads, ends previous open, omits empty from list, isolates owners', async () => {
    const alice = await createSession('conv_alice');
    const bob = await createSession('conv_bob');
    createdEmails.push(alice.email, bob.email);

    const workId = `work_conv_${Date.now().toString(36)}`;

    const first = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({
        surface: 'assist-read',
        subjectType: 'reading_work',
        subjectId: workId,
      }),
    });
    expect(first.status).toBe(HTTP_STATUS.CREATED);
    const firstBody = (await first.json()) as ConversationSummary;
    createdConversationIds.push(firstBody.id);
    expect(firstBody.endedAt).toBeNull();

    const second = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({
        surface: 'assist-read',
        subjectType: 'reading_work',
        subjectId: workId,
      }),
    });
    expect(second.status).toBe(HTTP_STATUS.CREATED);
    const secondBody = (await second.json()) as ConversationSummary;
    createdConversationIds.push(secondBody.id);

    const [firstRow] = await db.select().from(conversationTable).where(eq(conversationTable.id, firstBody.id)).limit(1);
    expect(firstRow?.endedAt).not.toBeNull();

    const emptyList = await app.request(
      `/api/conversations?surface=assist-read&subjectType=reading_work&subjectId=${workId}`,
      { headers: { cookie: alice.cookie } },
    );
    expect(emptyList.status).toBe(200);
    const emptyData = (await emptyList.json()) as ConversationListData;
    expect(emptyData.items).toHaveLength(0);

    await conversationsService.appendAssistTurn({
      userId: alice.userId,
      conversationId: secondBody.id,
      surface: 'assist-read',
      subjectType: 'reading_work',
      subjectId: workId,
      userContent: '这句话什么意思',
      assistantContent: '大意是…',
      assistantStatus: 'complete',
      userMetadata: { actionId: 'meaning', selection: 'The fox jumped.' },
    });

    const list = await app.request(
      `/api/conversations?surface=assist-read&subjectType=reading_work&subjectId=${workId}`,
      { headers: { cookie: alice.cookie } },
    );
    expect(list.status).toBe(200);
    const listData = (await list.json()) as ConversationListData;
    expect(listData.items).toHaveLength(1);
    expect(listData.items[0]!.id).toBe(secondBody.id);
    expect(listData.items[0]!.preview).toContain('这句话');

    const detail = await app.request(`/api/conversations/${secondBody.id}`, {
      headers: { cookie: alice.cookie },
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as ConversationDetail;
    expect(detailBody.messages).toHaveLength(2);
    expect(detailBody.messages[0]!.role).toBe('user');
    expect(detailBody.messages[1]!.role).toBe('assistant');

    const bobDetail = await app.request(`/api/conversations/${secondBody.id}`, {
      headers: { cookie: bob.cookie },
    });
    expect(bobDetail.status).toBe(HTTP_STATUS.NOT_FOUND);

    const unknown = await app.request('/api/conversations/does-not-exist', {
      headers: { cookie: alice.cookie },
    });
    expect(unknown.status).toBe(HTTP_STATUS.NOT_FOUND);

    await db.delete(conversationMessageTable).where(eq(conversationMessageTable.conversationId, secondBody.id));
  });
});
