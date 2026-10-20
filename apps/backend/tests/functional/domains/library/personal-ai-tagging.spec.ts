import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readingPart as readingPartTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  user as userTable,
  userPersonalTagPreference as preferenceTable,
  userPersonalTagRun as runTable,
  userTag as tagTable,
  userWorkTag as workTagTable,
  userWorkTagSuppression as suppressionTable,
} from '@gloaming/db';

import app from '@/app';
import {
  dispatchQueuedPersonalTagRuns,
  finalizeFailedPersonalTagRun,
  getPersonalTaggingPreference,
  JOB_PERSONAL_TAGGING,
  personalTaggingJobId,
  processPersonalTaggingJob,
  recordPersonalTagRunOnParseReady,
  setPersonalTaggingPreference,
} from '@/domains/library/tags/personal-ai-tagging';
import {
  assignUserTag,
  completeUserTagTranslations,
  renameUserTag,
  unassignUserTag,
} from '@/domains/library/tags/service';
import { startLockRenewal } from '@/infra/cache/lock';
import { db } from '@/infra/db';

const password = 'password123';
const { invokeAiMock, userProviderMock, acquireLockMock, lockHeldMock, enqueuePersonalTaggingMock } = vi.hoisted(
  () => ({
    invokeAiMock: vi.fn(),
    userProviderMock: vi.fn(),
    acquireLockMock: vi.fn(),
    lockHeldMock: vi.fn(),
    enqueuePersonalTaggingMock: vi.fn(),
  }),
);

vi.mock('@/infra/auth/mail', () => ({
  buildVerificationUrl: (token: string) => `http://localhost:3000/verify-email?token=${encodeURIComponent(token)}`,
  logDevAuthLink: vi.fn(),
  sendAuthMail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/ai', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, invokeAi: (...args: unknown[]) => invokeAiMock(...args) };
});

vi.mock('@/domains/provider-scope', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, resolveUserOwnedAppSettingValue: (...args: unknown[]) => userProviderMock(...args) };
});

vi.mock('@/infra/cache/lock', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    acquireLockWithWait: (...args: unknown[]) => acquireLockMock(...args),
    isLockHeldByToken: (...args: unknown[]) => lockHeldMock(...args),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    startLockRenewal: vi.fn(() => ({ stop: vi.fn() })),
  };
});

// Dispatcher assertions must never write jobs into the shared test Redis.
vi.mock('@/infra/queue', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, enqueuePersonalTagging: (...args: unknown[]) => enqueuePersonalTaggingMock(...args) };
});

function uniqueEmail() {
  return `personal-tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function createSession() {
  const email = uniqueEmail();
  const username = `tag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const signup = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password, name: 'tag user', username }),
  });
  expect(signup.status).toBe(200);
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
  const login = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const [user] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  return { email, cookie: cookieHeader(login), userId: user!.id };
}

describe('Personal AI Tagging', () => {
  const emails: string[] = [];
  const workIds: string[] = [];

  beforeEach(() => {
    invokeAiMock.mockReset();
    userProviderMock.mockReset().mockResolvedValue('user-owned-model');
    acquireLockMock.mockReset().mockResolvedValue(true);
    lockHeldMock.mockReset().mockResolvedValue(true);
    enqueuePersonalTaggingMock.mockReset().mockResolvedValue('job-id');
    vi.mocked(startLockRenewal)
      .mockReset()
      .mockImplementation(() => ({ stop: vi.fn() }));
  });

  afterAll(async () => {
    if (workIds.length) await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, workIds));
    for (const email of emails) await db.delete(userTable).where(eq(userTable.email, email));
  });

  async function createWork(userId: string, language = 'en-US') {
    const id = randomUUID();
    workIds.push(id);
    await db.insert(readingWorkTable).values({
      id,
      title: 'A bounded test book',
      author: 'Test Author',
      description: 'A brief description.',
      language,
      ownerUserId: userId,
      visibility: 'private',
      originKind: 'user_epub',
      processingStatus: 'ready',
    });
    await db.insert(readingPartTable).values({
      id: randomUUID(),
      workId: id,
      sortOrder: 0,
      title: 'Chapter One',
      body: '<p>A short bounded excerpt about space opera and distant worlds.</p>',
    });
    return id;
  }

  async function createRun(userId: string, workId: string) {
    await db.transaction((tx) => recordPersonalTagRunOnParseReady(tx, workId));
    const [run] = await db
      .select()
      .from(runTable)
      .where(and(eq(runTable.userId, userId), eq(runTable.workId, workId)))
      .limit(1);
    return run;
  }

  function aiResult(existingTagIds: string[] = []) {
    return {
      content: { existingTagIds, newTags: [] },
      model: { rowId: 'mock', label: 'Mock', modelId: 'mock' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    };
  }

  async function createTag(userId: string, name: string, locale = 'en-US') {
    const id = randomUUID();
    await db.insert(tagTable).values({
      id,
      userId,
      name,
      normalizedName: name.normalize('NFC').trim().toLowerCase(),
      sourceLocale: locale,
      localizedNames: { [locale]: name },
      userEditedLocales: [locale],
    });
    return id;
  }

  it('defaults off and does not create a historical run when enabled later', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    const work = await createWork(owner.userId);
    await db.transaction((tx) => recordPersonalTagRunOnParseReady(tx, work));
    expect(await db.select().from(runTable).where(eq(runTable.workId, work))).toHaveLength(0);

    const get = await app.request('/api/settings/personal-tagging', { headers: { cookie: owner.cookie } });
    const preference = (await get.json()) as Record<string, unknown>;
    expect(preference).toMatchObject({ enabled: false, generation: 0 });
    expect(preference).not.toHaveProperty('dailyInvocationLimit');
    expect(preference).not.toHaveProperty('dailyInvocationsUsed');
    expect(preference).not.toHaveProperty('dailyInvocationsReserved');
    await setPersonalTaggingPreference(owner.userId, true);
    expect(await db.select().from(runTable).where(eq(runTable.workId, work))).toHaveLength(0);
  });

  it('passes owner tags with localized names to AI and persists a cross-language stable-ID reuse', async () => {
    const owner = await createSession();
    const otherUser = await createSession();
    emails.push(owner.email, otherUser.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const work = await createWork(owner.userId, 'en-US');
    const ownerTag = await createTag(owner.userId, 'Science Fiction');
    const otherUserTag = await createTag(otherUser.userId, 'Science Fiction');
    const legacyTag = await createTag(owner.userId, 'Science Notes');
    await db
      .update(tagTable)
      .set({ localizedNames: { 'en-US': 'Science Fiction', 'zh-CN': '科幻' } })
      .where(eq(tagTable.id, ownerTag));
    await db.update(tagTable).set({ sourceLocale: null, localizedNames: {} }).where(eq(tagTable.id, legacyTag));
    const run = await createRun(owner.userId, work);
    invokeAiMock.mockResolvedValueOnce(aiResult([ownerTag]));

    await processPersonalTaggingJob({
      runId: run!.id,
      userId: owner.userId,
      workId: work,
      generation: run!.generation,
    });

    const request = invokeAiMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
      outputSchema: { safeParse: (value: unknown) => { success: boolean } };
    };
    const modelContext = JSON.parse(request.messages.find((message) => message.role === 'user')!.content) as {
      existingTags: Array<{
        id: string;
        name: string;
        sourceLocale: string | null;
        names: Record<string, string>;
      }>;
      book: { description: string; excerpt: string; tocTitles: string[] };
    };
    const systemPrompt = request.messages.find((message) => message.role === 'system')!.content;
    expect(modelContext.existingTags.find((tag) => tag.id === ownerTag)).toEqual({
      id: ownerTag,
      name: 'Science Fiction',
      sourceLocale: 'en-US',
      names: { 'en-US': 'Science Fiction', 'zh-CN': '科幻' },
    });
    expect(modelContext.existingTags.find((tag) => tag.id === legacyTag)).toEqual({
      id: legacyTag,
      name: 'Science Notes',
      sourceLocale: null,
      names: {},
    });
    expect(modelContext.existingTags.some((tag) => tag.id === otherUserTag)).toBe(false);
    expect(modelContext.book).toMatchObject({ description: 'A brief description.', tocTitles: ['Chapter One'] });
    expect(modelContext.book.excerpt).toContain('space opera');
    expect(systemPrompt).toContain(
      'Reuse an existing stable ID when its localized name or alias is semantically equivalent',
    );
    expect(systemPrompt).toContain('If a primary tag name has no source locale, treat it as an unlocalized label');
    expect(systemPrompt).toContain('If an existing tag or combination adequately covers the book, reuse it');
    expect(systemPrompt).toContain('Never create a one-book description');
    expect(request.outputSchema.safeParse({ existingTagIds: [ownerTag], newTags: [] }).success).toBe(true);

    const associations = await db.select().from(workTagTable).where(eq(workTagTable.workId, work));
    expect(associations.map((association) => association.tagId)).toEqual([ownerTag]);
    expect(await db.select().from(tagTable).where(eq(tagTable.userId, owner.userId))).toHaveLength(2);
  });

  it('applies existing-tag combinations for broad book topics without creating composite labels', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const scenarios = [
      { title: '科幻冒险悬疑小说', tags: ['科幻', '冒险', '悬疑'] },
      { title: 'React 应用开发指南', tags: ['前端开发', '软件工程'] },
      { title: '人工智能发展史', tags: ['历史', '技术', '科学'] },
    ];

    for (const scenario of scenarios) {
      const work = await createWork(owner.userId, 'zh-CN');
      await db.update(readingWorkTable).set({ title: scenario.title }).where(eq(readingWorkTable.id, work));
      const tagIds = await Promise.all(scenario.tags.map((name) => createTag(owner.userId, name, 'zh-CN')));
      const run = await createRun(owner.userId, work);
      invokeAiMock.mockResolvedValueOnce(aiResult(tagIds));

      await processPersonalTaggingJob({
        runId: run!.id,
        userId: owner.userId,
        workId: work,
        generation: run!.generation,
      });

      const associations = await db.select().from(workTagTable).where(eq(workTagTable.workId, work));
      expect(associations.map((association) => association.tagId).sort()).toEqual([...tagIds].sort());
    }

    const savedTags = await db.select().from(tagTable).where(eq(tagTable.userId, owner.userId));
    expect(savedTags.map((tag) => tag.name).sort()).toEqual(scenarios.flatMap((scenario) => scenario.tags).sort());
  });

  it('captures preference generation at ready time and never revives an old run after re-enable', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const work = await createWork(owner.userId);
    const run = await createRun(owner.userId, work);
    const duplicateRun = await createRun(owner.userId, work);
    expect(run?.generation).toBe(1);
    expect(duplicateRun?.id).toBe(run?.id);
    await setPersonalTaggingPreference(owner.userId, false);
    await setPersonalTaggingPreference(owner.userId, true);

    await processPersonalTaggingJob({
      runId: run!.id,
      userId: owner.userId,
      workId: work,
      generation: run!.generation,
    });
    expect(invokeAiMock).not.toHaveBeenCalled();
    const [savedRun] = await db.select().from(runTable).where(eq(runTable.id, run!.id));
    const [savedWork] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, work));
    expect(savedRun?.state).toBe('skipped');
    expect(savedWork?.processingStatus).toBe('ready');
  });

  it('skips without a user-owned Provider and accepts zero selected tags', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const noProviderWork = await createWork(owner.userId);
    const noProviderRun = await createRun(owner.userId, noProviderWork);
    userProviderMock.mockResolvedValueOnce(null);
    await processPersonalTaggingJob({
      runId: noProviderRun!.id,
      userId: owner.userId,
      workId: noProviderWork,
      generation: noProviderRun!.generation,
    });
    expect(invokeAiMock).not.toHaveBeenCalled();

    const emptyWork = await createWork(owner.userId);
    const emptyRun = await createRun(owner.userId, emptyWork);
    invokeAiMock.mockResolvedValueOnce({
      content: { existingTagIds: [], newTags: [] },
      model: { rowId: 'mock', label: 'Mock', modelId: 'mock' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    await processPersonalTaggingJob({
      runId: emptyRun!.id,
      userId: owner.userId,
      workId: emptyWork,
      generation: emptyRun!.generation,
    });
    expect(await db.select().from(workTagTable).where(eq(workTagTable.workId, emptyWork))).toHaveLength(0);
    expect(invokeAiMock).toHaveBeenCalledTimes(1);
  });

  it('does not restore a manually removed tag when an in-flight AI response arrives', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const work = await createWork(owner.userId);
    await db.insert(readingStateTable).values({
      id: randomUUID(),
      userId: owner.userId,
      workId: work,
      status: 'in_progress',
      revision: 4,
      anchorKind: 'part',
      anchorValue: 'chapter-one',
    });
    const tag = await createTag(owner.userId, 'Science Fiction');
    const run = await createRun(owner.userId, work);
    let resolveAi!: (value: unknown) => void;
    let markCalled!: () => void;
    const called = new Promise<void>((resolve) => {
      markCalled = resolve;
    });
    invokeAiMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAi = resolve;
          markCalled();
        }),
    );

    const job = processPersonalTaggingJob({
      runId: run!.id,
      userId: owner.userId,
      workId: work,
      generation: run!.generation,
    });
    await called;
    await unassignUserTag(owner.userId, work, tag);
    resolveAi({
      content: { existingTagIds: [tag], newTags: [] },
      model: { rowId: 'mock', label: 'Mock', modelId: 'mock' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    await job;

    expect(await db.select().from(workTagTable).where(eq(workTagTable.workId, work))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(suppressionTable)
        .where(and(eq(suppressionTable.workId, work), eq(suppressionTable.tagId, tag))),
    ).toHaveLength(1);
    await assignUserTag(owner.userId, work, tag);
    const [manual] = await db
      .select()
      .from(workTagTable)
      .where(and(eq(workTagTable.workId, work), eq(workTagTable.tagId, tag)));
    expect(manual?.source).toBe('manual');
    expect(await db.select().from(suppressionTable).where(eq(suppressionTable.workId, work))).toHaveLength(0);
    const [readingState] = await db
      .select()
      .from(readingStateTable)
      .where(and(eq(readingStateTable.userId, owner.userId), eq(readingStateTable.workId, work)));
    expect(readingState).toMatchObject({ status: 'in_progress', revision: 4, anchorValue: 'chapter-one' });
  });

  it('keeps the source name and association when automatic translation fails', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const work = await createWork(owner.userId, 'en-US');
    const run = await createRun(owner.userId, work);
    invokeAiMock
      .mockResolvedValueOnce({
        content: {
          existingTagIds: [],
          newTags: [
            {
              name: 'Space Opera',
              sourceLocale: 'en-US',
              reusable: true,
              distinctFromExisting: true,
              rationale: 'A durable science fiction subgenre',
            },
          ],
        },
        model: { rowId: 'mock', label: 'Mock', modelId: 'mock' },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      })
      .mockRejectedValueOnce(new Error('mock translation failure'));

    await processPersonalTaggingJob({
      runId: run!.id,
      userId: owner.userId,
      workId: work,
      generation: run!.generation,
    });
    const [tag] = await db
      .select()
      .from(tagTable)
      .where(and(eq(tagTable.userId, owner.userId), eq(tagTable.name, 'Space Opera')));
    const [association] = await db
      .select()
      .from(workTagTable)
      .where(and(eq(workTagTable.workId, work), eq(workTagTable.tagId, tag!.id)));
    expect(tag).toMatchObject({
      createdBy: 'ai',
      sourceLocale: 'en-US',
      localizedNames: { 'en-US': 'Space Opera' },
      userEditedLocales: [],
    });
    expect(tag?.localizedNames).not.toHaveProperty('zh-CN');
    expect(association?.source).toBe('ai');
  });

  it('does not overwrite a translation manually edited while the AI response is in flight', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const work = await createWork(owner.userId, 'en-US');
    const run = await createRun(owner.userId, work);
    let resolveTranslation!: (value: unknown) => void;
    let markTranslationStarted!: () => void;
    const translationStarted = new Promise<void>((resolve) => {
      markTranslationStarted = resolve;
    });
    invokeAiMock
      .mockResolvedValueOnce({
        content: {
          existingTagIds: [],
          newTags: [
            {
              name: 'Space Opera',
              sourceLocale: 'en-US',
              reusable: true,
              distinctFromExisting: true,
              rationale: 'A durable science fiction subgenre',
            },
          ],
        },
        model: { rowId: 'mock', label: 'Mock', modelId: 'mock' },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTranslation = resolve;
            markTranslationStarted();
          }),
      );

    const job = processPersonalTaggingJob({
      runId: run!.id,
      userId: owner.userId,
      workId: work,
      generation: run!.generation,
    });
    await translationStarted;
    const [tag] = await db
      .select({ id: tagTable.id })
      .from(tagTable)
      .where(and(eq(tagTable.userId, owner.userId), eq(tagTable.name, 'Space Opera')));
    await renameUserTag(owner.userId, tag!.id, '太空歌剧', 'zh-CN');
    resolveTranslation({
      content: { translations: [{ locale: 'zh-CN', name: 'Space Opera 的中文翻译' }] },
      model: { rowId: 'mock', label: 'Mock', modelId: 'mock' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    await job;

    const [saved] = await db.select().from(tagTable).where(eq(tagTable.id, tag!.id));
    expect(saved?.localizedNames).toMatchObject({ 'en-US': 'Space Opera', 'zh-CN': '太空歌剧' });
    expect(saved?.userEditedLocales).toContain('zh-CN');
  });

  it('does not create a run when the work is not parse-ready or is not a Personal EPUB', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);

    const notReady = await createWork(owner.userId);
    await db.update(readingWorkTable).set({ processingStatus: 'processing' }).where(eq(readingWorkTable.id, notReady));
    await db.transaction((tx) => recordPersonalTagRunOnParseReady(tx, notReady));
    expect(await db.select().from(runTable).where(eq(runTable.workId, notReady))).toHaveLength(0);

    const failed = await createWork(owner.userId);
    await db.update(readingWorkTable).set({ processingStatus: 'failed' }).where(eq(readingWorkTable.id, failed));
    await db.transaction((tx) => recordPersonalTagRunOnParseReady(tx, failed));
    expect(await db.select().from(runTable).where(eq(runTable.workId, failed))).toHaveLength(0);

    const catalog = await createWork(owner.userId);
    await db
      .update(readingWorkTable)
      .set({ originKind: null, ownerUserId: null })
      .where(eq(readingWorkTable.id, catalog));
    await db.transaction((tx) => recordPersonalTagRunOnParseReady(tx, catalog));
    expect(await db.select().from(runTable).where(eq(runTable.workId, catalog))).toHaveLength(0);
  });

  it('does not create a run when the owner has not opted in', async () => {
    const owner = await createSession();
    emails.push(owner.email);

    const neverOptedIn = await createWork(owner.userId);
    expect(await db.select().from(preferenceTable).where(eq(preferenceTable.userId, owner.userId))).toHaveLength(0);
    await db.transaction((tx) => recordPersonalTagRunOnParseReady(tx, neverOptedIn));
    expect(await db.select().from(runTable).where(eq(runTable.workId, neverOptedIn))).toHaveLength(0);

    await setPersonalTaggingPreference(owner.userId, true);
    await setPersonalTaggingPreference(owner.userId, false);
    const optedOut = await createWork(owner.userId);
    await db.transaction((tx) => recordPersonalTagRunOnParseReady(tx, optedOut));
    expect(await db.select().from(runTable).where(eq(runTable.workId, optedOut))).toHaveLength(0);
    const [preference] = await db.select().from(preferenceTable).where(eq(preferenceTable.userId, owner.userId));
    expect(preference).toMatchObject({ enabled: false });
  });

  it('is idempotent across repeated ready events for the same generation', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const work = await createWork(owner.userId);

    await db.transaction((tx) => recordPersonalTagRunOnParseReady(tx, work));
    await db.transaction((tx) => recordPersonalTagRunOnParseReady(tx, work));
    await db.transaction((tx) => recordPersonalTagRunOnParseReady(tx, work));

    const runs = await db.select().from(runTable).where(eq(runTable.workId, work));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ generation: 1, state: 'queued' });
  });

  it('completes more than ten same-day tagging runs without a daily invocation gate', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);

    const jobs: Array<{ runId: string; workId: string; generation: number }> = [];
    for (let index = 0; index < 11; index += 1) {
      const work = await createWork(owner.userId);
      const run = await createRun(owner.userId, work);
      jobs.push({ runId: run!.id, workId: work, generation: run!.generation });
    }
    invokeAiMock.mockResolvedValue(aiResult());

    for (const job of jobs) {
      await processPersonalTaggingJob({ userId: owner.userId, ...job });
    }

    expect(invokeAiMock).toHaveBeenCalledTimes(11);
    const completed = await db
      .select()
      .from(runTable)
      .where(
        inArray(
          runTable.id,
          jobs.map((job) => job.runId),
        ),
      );
    expect(completed).toHaveLength(11);
    expect(completed.every((run) => run.state === 'completed')).toBe(true);
  });

  it('discards the AI result and writes nothing after a lost Redis lease, then completes on retry', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const work = await createWork(owner.userId);
    const tag = await createTag(owner.userId, 'Science Fiction');
    const run = await createRun(owner.userId, work);

    let onLeaseLost: (() => void) | undefined;
    vi.mocked(startLockRenewal).mockImplementationOnce((_key, _token, _ttlSeconds, options) => {
      onLeaseLost = options?.onLeaseLost;
      return { stop: vi.fn() };
    });

    let resolveFirstAi!: (value: unknown) => void;
    let markAiStarted!: () => void;
    const aiStarted = new Promise<void>((resolve) => {
      markAiStarted = resolve;
    });
    invokeAiMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstAi = resolve;
          markAiStarted();
        }),
    );
    invokeAiMock.mockResolvedValueOnce(aiResult([tag]));

    const firstAttempt = processPersonalTaggingJob({
      runId: run!.id,
      userId: owner.userId,
      workId: work,
      generation: run!.generation,
    });
    await aiStarted;
    onLeaseLost?.();
    resolveFirstAi(aiResult([tag]));
    await expect(firstAttempt).rejects.toThrow('PERSONAL_TAGGING_LEASE_LOST');

    expect(await db.select().from(workTagTable).where(eq(workTagTable.workId, work))).toHaveLength(0);
    const [interrupted] = await db.select().from(runTable).where(eq(runTable.id, run!.id));
    expect(interrupted).toMatchObject({ state: 'processing', attempts: 1 });

    await processPersonalTaggingJob({
      runId: run!.id,
      userId: owner.userId,
      workId: work,
      generation: run!.generation,
    });

    expect(invokeAiMock).toHaveBeenCalledTimes(2);
    const associations = await db.select().from(workTagTable).where(eq(workTagTable.workId, work));
    expect(associations).toHaveLength(1);
    expect(associations[0]).toMatchObject({ tagId: tag, source: 'ai' });
    const [completed] = await db.select().from(runTable).where(eq(runTable.id, run!.id));
    expect(completed).toMatchObject({ state: 'completed', attempts: 2 });
  });

  it('performs no second AI call or write when a completed run is delivered again', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const work = await createWork(owner.userId);
    const tag = await createTag(owner.userId, 'Space Opera');
    const run = await createRun(owner.userId, work);
    invokeAiMock.mockResolvedValueOnce(aiResult([tag]));

    const job = {
      runId: run!.id,
      userId: owner.userId,
      workId: work,
      generation: run!.generation,
    };
    await processPersonalTaggingJob(job);
    expect(invokeAiMock).toHaveBeenCalledTimes(1);
    expect(await db.select().from(workTagTable).where(eq(workTagTable.workId, work))).toHaveLength(1);

    await processPersonalTaggingJob(job);

    expect(invokeAiMock).toHaveBeenCalledTimes(1);
    expect(await db.select().from(workTagTable).where(eq(workTagTable.workId, work))).toHaveLength(1);
    const [completed] = await db.select().from(runTable).where(eq(runTable.id, run!.id));
    expect(completed).toMatchObject({ state: 'completed' });
  });

  it('does not invoke the translation provider when the owner disables tagging during classification', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const work = await createWork(owner.userId, 'en-US');
    const run = await createRun(owner.userId, work);

    let resolveClassification!: (value: unknown) => void;
    let markClassificationStarted!: () => void;
    const classificationStarted = new Promise<void>((resolve) => {
      markClassificationStarted = resolve;
    });
    invokeAiMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveClassification = resolve;
          markClassificationStarted();
        }),
    );

    const job = processPersonalTaggingJob({
      runId: run!.id,
      userId: owner.userId,
      workId: work,
      generation: run!.generation,
    });
    await classificationStarted;
    await setPersonalTaggingPreference(owner.userId, false);
    resolveClassification({
      content: {
        existingTagIds: [],
        newTags: [
          {
            name: 'Space Opera',
            sourceLocale: 'en-US',
            reusable: true,
            distinctFromExisting: true,
            rationale: 'A durable science fiction subgenre',
          },
        ],
      },
      model: { rowId: 'mock', label: 'Mock', modelId: 'mock' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    await job;

    expect(invokeAiMock).toHaveBeenCalledTimes(1);
    const [savedRun] = await db.select().from(runTable).where(eq(runTable.id, run!.id));
    expect(savedRun).toMatchObject({ state: 'skipped', errorCode: 'authorization_expired' });
    expect(await db.select().from(tagTable).where(eq(tagTable.userId, owner.userId))).toHaveLength(0);
    expect(await db.select().from(workTagTable).where(eq(workTagTable.workId, work))).toHaveLength(0);
  });

  it('skips translation for a disabled preference without invoking the provider', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const tagId = await createTag(owner.userId, 'Space Opera', 'en-US');
    await setPersonalTaggingPreference(owner.userId, false);

    const result = await completeUserTagTranslations(owner.userId, tagId, {
      source: 'personal-tagging.translation',
      providerScope: 'user-only',
      maxTokens: 800,
      maxRetries: 0,
      authorizationGeneration: 1,
    });

    expect(result.status).toBe('incomplete');
    expect(invokeAiMock).not.toHaveBeenCalled();
    const [saved] = await db.select().from(tagTable).where(eq(tagTable.id, tagId));
    expect(saved?.localizedNames).not.toHaveProperty('zh-CN');
  });

  it('defers a busy same-user run instead of failing it and re-enqueues it on the next dispatch pass', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const work = await createWork(owner.userId);
    const run = await createRun(owner.userId, work);
    const enqueuedAt = new Date(Date.now() - 60_000);
    await db.update(runTable).set({ updatedAt: enqueuedAt }).where(eq(runTable.id, run!.id));
    acquireLockMock.mockResolvedValueOnce(false);

    const job = { runId: run!.id, userId: owner.userId, workId: work, generation: run!.generation };
    const result = await processPersonalTaggingJob(job);

    // The busy lock is a deferral, not a failure: no AI call, no BullMQ failure path.
    expect(result).toMatchObject({ ok: true, deferred: true });
    expect(invokeAiMock).not.toHaveBeenCalled();
    const [deferred] = await db.select().from(runTable).where(eq(runTable.id, run!.id));
    expect(deferred).toMatchObject({ state: 'queued', attempts: 0, errorCode: null });
    expect(personalTaggingJobId({ id: run!.id, updatedAt: deferred!.updatedAt })).not.toBe(
      personalTaggingJobId({ id: run!.id, updatedAt: enqueuedAt }),
    );

    // The worker's failed-terminal finalize must not turn a never-claimed run into a failure.
    await finalizeFailedPersonalTagRun(job);
    const [afterFinalize] = await db.select().from(runTable).where(eq(runTable.id, run!.id));
    expect(afterFinalize).toMatchObject({ state: 'queued', errorCode: null });

    await dispatchQueuedPersonalTagRuns();
    const call = enqueuePersonalTaggingMock.mock.calls.find(
      ([, data]) => (data as { runId: string }).runId === run!.id,
    );
    expect(call).toBeDefined();
    expect(call![0]).toBe(JOB_PERSONAL_TAGGING);
    expect(call![1]).toEqual({ runId: run!.id, userId: owner.userId, workId: work, generation: run!.generation });
    expect(call![2]).toMatchObject({
      jobId: personalTaggingJobId({ id: run!.id, updatedAt: afterFinalize!.updatedAt }),
    });
  });

  it('recovers a stalled processing run with attempts left and skips fresh or exhausted ones', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    await setPersonalTaggingPreference(owner.userId, true);
    const stale = await createRun(owner.userId, await createWork(owner.userId));
    const fresh = await createRun(owner.userId, await createWork(owner.userId));
    const exhausted = await createRun(owner.userId, await createWork(owner.userId));
    const staleAt = new Date(Date.now() - 11 * 60_000);
    await db
      .update(runTable)
      .set({ state: 'processing', attempts: 1, updatedAt: staleAt })
      .where(eq(runTable.id, stale!.id));
    await db
      .update(runTable)
      .set({ state: 'processing', attempts: 1, updatedAt: new Date() })
      .where(eq(runTable.id, fresh!.id));
    await db
      .update(runTable)
      .set({ state: 'processing', attempts: 2, updatedAt: staleAt })
      .where(eq(runTable.id, exhausted!.id));

    await dispatchQueuedPersonalTagRuns();

    const ids = [stale!.id, fresh!.id, exhausted!.id];
    const dispatched = enqueuePersonalTaggingMock.mock.calls
      .filter(([, data]) => ids.includes((data as { runId: string }).runId))
      .map(([, data]) => (data as { runId: string }).runId);
    expect(dispatched).toEqual([stale!.id]);
    const [call] = enqueuePersonalTaggingMock.mock.calls.filter(
      ([, data]) => (data as { runId: string }).runId === stale!.id,
    );
    expect(call![0]).toBe(JOB_PERSONAL_TAGGING);
    // The claim already accepts a processing re-entry, so the stable id keeps the recovery idempotent.
    expect(call![2]).toMatchObject({ jobId: personalTaggingJobId({ id: stale!.id, updatedAt: staleAt }) });
  });

  it('exposes the latest run state and error code on the personal tagging settings DTO', async () => {
    const owner = await createSession();
    emails.push(owner.email);

    const before = (await (
      await app.request('/api/settings/personal-tagging', { headers: { cookie: owner.cookie } })
    ).json()) as Record<string, unknown>;
    expect(before).toMatchObject({ enabled: false, latestRunState: null, latestRunErrorCode: null });

    await setPersonalTaggingPreference(owner.userId, true);
    const work = await createWork(owner.userId);
    const run = await createRun(owner.userId, work);
    await db
      .update(runTable)
      .set({ state: 'failed', errorCode: 'attempts_exhausted', updatedAt: new Date() })
      .where(eq(runTable.id, run!.id));

    const after = (await (
      await app.request('/api/settings/personal-tagging', { headers: { cookie: owner.cookie } })
    ).json()) as Record<string, unknown>;
    expect(after).toMatchObject({
      enabled: true,
      latestRunState: 'failed',
      latestRunErrorCode: 'attempts_exhausted',
    });

    const preference = await getPersonalTaggingPreference(owner.userId);
    expect(preference.latestRunErrorCode).toBe('attempts_exhausted');
  });
});
