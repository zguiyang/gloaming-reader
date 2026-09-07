import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  conversationMessage as conversationMessageTable,
  readingWork as readingWorkTable,
  user as userTable,
} from '@gloaming/db';
import type { AdminWork } from '@gloaming/shared';
import { ASSIST_SSE_EVENT, type AssistSseDone, type AssistSseError } from '@gloaming/shared';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError } from '@/lib/errors';
import * as aiService from '@/modules/ai/service';
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

async function createPublishedWork(adminCookie: string, title: string, body: string): Promise<AdminWork> {
  const create = await app.request('/api/admin/works', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ title, body }),
  });
  expect(create.status).toBe(201);
  const work = (await create.json()) as AdminWork;
  expect(
    (
      await app.request(`/api/admin/works/${work.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ sources: ['demo'], tags: ['test'] }),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await app.request(`/api/admin/works/${work.id}/publish`, {
        method: 'POST',
        headers: { cookie: adminCookie },
      })
    ).status,
  ).toBe(200);
  return work;
}

type ParsedSse = { event?: string; data: string };

function parseSseBlocks(raw: string): ParsedSse[] {
  const blocks = raw
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.map((block) => {
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim());
      }
    }
    return { event, data: dataLines.join('\n') };
  });
}

async function* okStream(): AsyncGenerator<aiService.AiStreamEvent> {
  yield { type: 'delta', text: '狐狸' };
  yield { type: 'delta', text: '跳过了懒狗。' };
  yield {
    type: 'done',
    content: '狐狸跳过了懒狗。',
    model: { rowId: 'm1', label: 'Test', modelId: 'gpt-test' },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
}

describe('Assist HTTP', () => {
  const createdEmails: string[] = [];
  const createdWorkIds: string[] = [];

  afterAll(async () => {
    if (createdWorkIds.length > 0) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('streams assist reply via ai.stream and surfaces AI errors as SSE error events', async () => {
    const admin = await createSession('admin');
    const user = await createSession();
    createdEmails.push(admin.email, user.email);

    const work = await createPublishedWork(
      admin.cookie,
      'Assist Test',
      'The fox jumped over the lazy dog near the river.',
    );
    createdWorkIds.push(work.id);
    const partId = work.parts[0]!.id;

    const streamSpy = vi.spyOn(aiService, 'streamAi').mockImplementation(() => okStream());
    const invokeSpy = vi.spyOn(aiService, 'invokeAi').mockResolvedValue({
      content: { suggestions: ['追问一', '追问二', '追问三'] },
      model: { rowId: 'm1', label: 'Test', modelId: 'gpt-test' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const ok = await app.request('/api/assist/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({
        workId: work.id,
        partId,
        actionId: 'meaning',
        selection: 'The fox jumped over the lazy dog',
      }),
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type') ?? '').toContain('text/event-stream');
    const okBody = await ok.text();
    const okEvents = parseSseBlocks(okBody);
    expect(okEvents.map((e) => e.event)).toEqual([
      ASSIST_SSE_EVENT.delta,
      ASSIST_SSE_EVENT.delta,
      ASSIST_SSE_EVENT.done,
    ]);
    const done = JSON.parse(okEvents[2]!.data) as AssistSseDone;
    expect(done.reply).toContain('狐狸');
    expect(done.model?.label).toBe('Test');
    expect(done.suggestions).toEqual(['追问一', '追问二', '追问三']);
    expect(done.conversationId).toBeTruthy();
    expect(streamSpy).toHaveBeenCalled();
    expect(invokeSpy).toHaveBeenCalled();

    const messages = await db
      .select()
      .from(conversationMessageTable)
      .where(eq(conversationMessageTable.conversationId, done.conversationId!));
    expect(messages).toHaveLength(2);

    async function* failStream(): AsyncGenerator<aiService.AiStreamEvent> {
      throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'AI unavailable');
      yield { type: 'delta', text: '' };
    }

    streamSpy.mockImplementation(() => failStream());
    const unavailable = await app.request('/api/assist/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({
        workId: work.id,
        partId,
        actionId: 'meaning',
        selection: 'The fox jumped over the lazy dog',
      }),
    });
    expect(unavailable.status).toBe(200);
    const errEvents = parseSseBlocks(await unavailable.text());
    expect(errEvents.some((e) => e.event === ASSIST_SSE_EVENT.error)).toBe(true);
    const errPayload = JSON.parse(errEvents.find((e) => e.event === ASSIST_SSE_EVENT.error)!.data) as AssistSseError;
    expect(errPayload.error).toMatch(/AI unavailable/i);
    streamSpy.mockRestore();
    invokeSpy.mockRestore();
  });

  it('accepts gist without selection and omits suggestions when follow-ups fail', async () => {
    const admin = await createSession('admin');
    const user = await createSession();
    createdEmails.push(admin.email, user.email);

    const work = await createPublishedWork(
      admin.cookie,
      'Gist Test',
      'The ocean covers more than seventy percent of Earth.',
    );
    createdWorkIds.push(work.id);
    const partId = work.parts[0]!.id;

    const streamSpy = vi.spyOn(aiService, 'streamAi').mockImplementation(() => okStream());
    const invokeSpy = vi.spyOn(aiService, 'invokeAi').mockRejectedValue(new Error('follow-up failed'));

    const ok = await app.request('/api/assist/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({
        workId: work.id,
        partId,
        actionId: 'gist',
      }),
    });
    expect(ok.status).toBe(200);
    const rawBody = await ok.text();
    expect(streamSpy).toHaveBeenCalled();
    const call = streamSpy.mock.calls[0]?.[0];
    expect(call?.messages.some((m) => m.content.includes('No text selection'))).toBe(true);

    const done = JSON.parse(
      parseSseBlocks(rawBody).find((e) => e.event === ASSIST_SSE_EVENT.done)!.data,
    ) as AssistSseDone;
    expect(done.reply).toContain('狐狸');
    expect(done.suggestions).toBeUndefined();

    streamSpy.mockRestore();
    invokeSpy.mockRestore();
  });

  it('rejects meaning without selection and qa without question', async () => {
    const admin = await createSession('admin');
    const user = await createSession();
    createdEmails.push(admin.email, user.email);

    const work = await createPublishedWork(admin.cookie, 'Validation Test', 'Hello world.');
    createdWorkIds.push(work.id);
    const partId = work.parts[0]!.id;

    const missingSelection = await app.request('/api/assist/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({
        workId: work.id,
        partId,
        actionId: 'meaning',
      }),
    });
    expect(missingSelection.status).toBe(HTTP_STATUS.BAD_REQUEST);

    const missingQuestion = await app.request('/api/assist/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({
        workId: work.id,
        partId,
        actionId: 'qa',
      }),
    });
    expect(missingQuestion.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('accepts qa without selection when question is present', async () => {
    const admin = await createSession('admin');
    const user = await createSession();
    createdEmails.push(admin.email, user.email);

    const work = await createPublishedWork(admin.cookie, 'QA Test', 'Birds fly south in winter.');
    createdWorkIds.push(work.id);
    const partId = work.parts[0]!.id;

    const streamSpy = vi.spyOn(aiService, 'streamAi').mockImplementation(() => okStream());
    const invokeSpy = vi.spyOn(aiService, 'invokeAi').mockResolvedValue({
      content: { suggestions: ['A', 'B', 'C'] },
      model: { rowId: 'm1', label: 'Test', modelId: 'gpt-test' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const ok = await app.request('/api/assist/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({
        workId: work.id,
        partId,
        actionId: 'qa',
        question: '这篇在讲什么？',
      }),
    });
    expect(ok.status).toBe(200);
    await ok.text();
    expect(streamSpy).toHaveBeenCalled();

    streamSpy.mockRestore();
    invokeSpy.mockRestore();
  });

  it('appends a second ask to the same conversation and rejects wrong work id', async () => {
    const admin = await createSession('admin');
    const user = await createSession();
    createdEmails.push(admin.email, user.email);

    const work = await createPublishedWork(
      admin.cookie,
      'Resume Test',
      'The fox jumped over the lazy dog near the river.',
    );
    const other = await createPublishedWork(admin.cookie, 'Other', 'Another published work body.');
    createdWorkIds.push(work.id, other.id);
    const partId = work.parts[0]!.id;
    const otherPartId = other.parts[0]!.id;

    const streamSpy = vi.spyOn(aiService, 'streamAi').mockImplementation(() => okStream());
    const invokeSpy = vi.spyOn(aiService, 'invokeAi').mockResolvedValue({
      content: { suggestions: ['一', '二', '三'] },
      model: { rowId: 'm1', label: 'Test', modelId: 'gpt-test' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const first = await app.request('/api/assist/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({
        workId: work.id,
        partId,
        actionId: 'meaning',
        selection: 'The fox jumped over the lazy dog',
      }),
    });
    expect(first.status).toBe(200);
    const firstDone = JSON.parse(
      parseSseBlocks(await first.text()).find((e) => e.event === ASSIST_SSE_EVENT.done)!.data,
    ) as AssistSseDone;
    expect(firstDone.conversationId).toBeTruthy();

    const second = await app.request('/api/assist/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({
        workId: work.id,
        partId,
        actionId: 'qa',
        question: '还有别的意思吗？',
        conversationId: firstDone.conversationId,
      }),
    });
    expect(second.status).toBe(200);
    const secondDone = JSON.parse(
      parseSseBlocks(await second.text()).find((e) => e.event === ASSIST_SSE_EVENT.done)!.data,
    ) as AssistSseDone;
    expect(secondDone.conversationId).toBe(firstDone.conversationId);

    const messageCount = await db
      .select()
      .from(conversationMessageTable)
      .where(eq(conversationMessageTable.conversationId, firstDone.conversationId!));
    expect(messageCount).toHaveLength(4);

    const wrongWork = await app.request('/api/assist/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({
        workId: other.id,
        partId: otherPartId,
        actionId: 'gist',
        conversationId: firstDone.conversationId,
      }),
    });
    expect(wrongWork.status).toBe(200);
    const wrongEvents = parseSseBlocks(await wrongWork.text());
    expect(wrongEvents.some((e) => e.event === ASSIST_SSE_EVENT.error)).toBe(true);
    const errPayload = JSON.parse(wrongEvents.find((e) => e.event === ASSIST_SSE_EVENT.error)!.data) as AssistSseError;
    expect(errPayload.error).toMatch(/conversation does not match work/i);

    streamSpy.mockRestore();
    invokeSpy.mockRestore();
  });

  it('still returns reply when transcript persist fails', async () => {
    const admin = await createSession('admin');
    const user = await createSession();
    createdEmails.push(admin.email, user.email);

    const work = await createPublishedWork(
      admin.cookie,
      'Persist Fail',
      'The fox jumped over the lazy dog near the river.',
    );
    createdWorkIds.push(work.id);
    const partId = work.parts[0]!.id;

    const streamSpy = vi.spyOn(aiService, 'streamAi').mockImplementation(() => okStream());
    const invokeSpy = vi.spyOn(aiService, 'invokeAi').mockResolvedValue({
      content: { suggestions: ['一', '二', '三'] },
      model: { rowId: 'm1', label: 'Test', modelId: 'gpt-test' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const persistSpy = vi.spyOn(conversationsService, 'appendAssistTurn').mockRejectedValue(new Error('db down'));

    const ok = await app.request('/api/assist/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', cookie: user.cookie },
      body: JSON.stringify({
        workId: work.id,
        partId,
        actionId: 'gist',
      }),
    });
    expect(ok.status).toBe(200);
    const done = JSON.parse(
      parseSseBlocks(await ok.text()).find((e) => e.event === ASSIST_SSE_EVENT.done)!.data,
    ) as AssistSseDone;
    expect(done.reply).toContain('狐狸');
    expect(done.conversationId).toBeUndefined();

    persistSpy.mockRestore();
    streamSpy.mockRestore();
    invokeSpy.mockRestore();
  });
});
