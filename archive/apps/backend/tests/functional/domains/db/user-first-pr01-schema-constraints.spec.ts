import { randomUUID } from 'node:crypto';

import { eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  llmAppSetting as llmAppSettingTable,
  llmProvider as llmProviderTable,
  readingWork as readingWorkTable,
  ttsConfig as ttsConfigTable,
  user as userTable,
  userLibraryItem as userLibraryItemTable,
} from '@gloaming/db';

import { db } from '@/infra/db';
import { encryptApiKey } from '@/infra/llm';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function isUniqueViolation(error: unknown): boolean {
  const maxDepth = 8;
  let current: unknown = error;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }

    if ('code' in current && (current as { code: string }).code === '23505') {
      return true;
    }

    const cause = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
    if (cause === undefined || cause === current) {
      return false;
    }
    current = cause;
  }

  return false;
}

async function expectUniqueViolation(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    expect.fail('expected unique violation');
  } catch (error) {
    expect(isUniqueViolation(error)).toBe(true);
  }
}

async function insertUser(label: string) {
  const id = randomUUID();
  const email = uniqueEmail(label);
  await db.insert(userTable).values({
    id,
    name: label,
    email,
    emailVerified: true,
    role: 'user',
  });
  return { id, email };
}

async function insertWork() {
  const id = randomUUID();
  await db.insert(readingWorkTable).values({
    id,
    title: `pr01-${id.slice(0, 8)}`,
    processingStatus: 'ready',
    visibility: 'catalog',
  });
  return id;
}

const providerStub = {
  apiFamily: 'openai' as const,
  baseUrl: 'https://example.com/v1',
  apiKeyCiphertext: encryptApiKey('sk-pr01-constraint'),
  isEnabled: true,
};

const ttsStub = {
  provider: 'azure',
  region: 'eastus',
  apiKeyCiphertext: encryptApiKey('tts-pr01'),
  isEnabled: true,
  defaultVoice: 'en-US-JennyNeural',
  usVoice: 'en-US-JennyNeural',
  ukVoice: 'en-GB-SoniaNeural',
};

describe('PR-01 user-first schema constraints', () => {
  const userEmails: string[] = [];
  const workIds: string[] = [];
  const providerIds: string[] = [];
  const settingIds: string[] = [];
  const ttsIds: string[] = [];
  const libraryItemIds: string[] = [];

  afterAll(async () => {
    if (libraryItemIds.length > 0) {
      await db.delete(userLibraryItemTable).where(inArray(userLibraryItemTable.id, libraryItemIds));
    }
    if (settingIds.length > 0) {
      await db.delete(llmAppSettingTable).where(inArray(llmAppSettingTable.id, settingIds));
    }
    if (providerIds.length > 0) {
      await db.delete(llmProviderTable).where(inArray(llmProviderTable.id, providerIds));
    }
    if (ttsIds.length > 0) {
      await db.delete(ttsConfigTable).where(inArray(ttsConfigTable.id, ttsIds));
    }
    if (workIds.length > 0) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, workIds));
    }
    for (const email of userEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('rejects duplicate library membership for the same user and work', async () => {
    const user = await insertUser('library-dup');
    userEmails.push(user.email);
    const workId = await insertWork();
    workIds.push(workId);

    const libraryId = randomUUID();
    libraryItemIds.push(libraryId);
    await db.insert(userLibraryItemTable).values({
      id: libraryId,
      userId: user.id,
      workId,
    });

    await expectUniqueViolation(() =>
      db.insert(userLibraryItemTable).values({
        id: randomUUID(),
        userId: user.id,
        workId,
      }),
    );
  });

  it('enforces user-scoped provider names while allowing instance duplicates and cross-user reuse', async () => {
    const userA = await insertUser('provider-a');
    const userB = await insertUser('provider-b');
    userEmails.push(userA.email, userB.email);

    const sharedName = `shared-provider-${randomUUID().slice(0, 8)}`;

    const instanceOne = randomUUID();
    const instanceTwo = randomUUID();
    providerIds.push(instanceOne, instanceTwo);
    await db.insert(llmProviderTable).values([
      { id: instanceOne, name: sharedName, ...providerStub },
      { id: instanceTwo, name: sharedName, ...providerStub },
    ]);

    const userAProvider = randomUUID();
    providerIds.push(userAProvider);
    await db.insert(llmProviderTable).values({
      id: userAProvider,
      name: sharedName,
      ownerUserId: userA.id,
      ...providerStub,
    });

    await expectUniqueViolation(() =>
      db.insert(llmProviderTable).values({
        id: randomUUID(),
        name: sharedName,
        ownerUserId: userA.id,
        ...providerStub,
      }),
    );

    const userBProvider = randomUUID();
    providerIds.push(userBProvider);
    await db.insert(llmProviderTable).values({
      id: userBProvider,
      name: sharedName,
      ownerUserId: userB.id,
      ...providerStub,
    });
  });

  it('allows the same setting key in instance and user scopes but not duplicates within a scope', async () => {
    const user = await insertUser('setting-scope');
    userEmails.push(user.email);

    const key = `pr01.setting.${randomUUID().slice(0, 8)}`;

    const instanceSettingId = randomUUID();
    const userSettingId = randomUUID();
    settingIds.push(instanceSettingId, userSettingId);

    await db.insert(llmAppSettingTable).values({
      id: instanceSettingId,
      key,
      value: 'instance-value',
    });
    await db.insert(llmAppSettingTable).values({
      id: userSettingId,
      ownerUserId: user.id,
      key,
      value: 'user-value',
    });

    await expectUniqueViolation(() =>
      db.insert(llmAppSettingTable).values({
        id: randomUUID(),
        key,
        value: 'second-instance',
      }),
    );

    await expectUniqueViolation(() =>
      db.insert(llmAppSettingTable).values({
        id: randomUUID(),
        ownerUserId: user.id,
        key,
        value: 'second-user',
      }),
    );
  });

  it('allows one instance TTS row and one per user but rejects duplicates within each scope', async () => {
    const user = await insertUser('tts-scope');
    userEmails.push(user.email);

    const userTtsId = randomUUID();
    ttsIds.push(userTtsId);
    await db.insert(ttsConfigTable).values({
      id: userTtsId,
      ownerUserId: user.id,
      ...ttsStub,
    });

    await expectUniqueViolation(() =>
      db.insert(ttsConfigTable).values({
        id: randomUUID(),
        ownerUserId: user.id,
        ...ttsStub,
      }),
    );

    const instanceRows = await db
      .select({ id: ttsConfigTable.id })
      .from(ttsConfigTable)
      .where(isNull(ttsConfigTable.ownerUserId));
    if (instanceRows.length === 0) {
      const instanceId = randomUUID();
      ttsIds.push(instanceId);
      await db.insert(ttsConfigTable).values({
        id: instanceId,
        ...ttsStub,
      });
    }

    await expectUniqueViolation(() =>
      db.insert(ttsConfigTable).values({
        id: randomUUID(),
        ...ttsStub,
      }),
    );
  });
});
