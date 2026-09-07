import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  readingWorkTag as readingWorkTagTable,
  tag as tagTable,
  user as userTable,
} from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/db';
import { normalizeTag } from '@/lib/text';

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

describe('taxonomy SSOT projection', () => {
  const workIds: string[] = [];
  const tagIds: string[] = [];
  let adminCookie = '';

  beforeAll(async () => {
    const email = uniqueEmail('ssot-admin');
    const username = `ssot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password, name: 'ssot-admin', username }),
    });
    await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
    await db.update(userTable).set({ role: AUTH_ADMIN_ROLE }).where(eq(userTable.email, email));
    const login = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password }),
    });
    adminCookie = cookieHeader(login);
  });

  afterAll(async () => {
    if (workIds.length > 0) {
      await db.delete(readingWorkTagTable).where(inArray(readingWorkTagTable.workId, workIds));
      await db.delete(readingPartTable).where(inArray(readingPartTable.workId, workIds));
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, workIds));
    }
    if (tagIds.length > 0) {
      await db.delete(tagTable).where(inArray(tagTable.id, tagIds));
    }
  });

  async function seedPublishedWorkWithTag(tagName: string): Promise<string> {
    const workId = randomUUID();
    const tagId = randomUUID();
    workIds.push(workId);
    tagIds.push(tagId);

    await db.insert(readingWorkTable).values({
      id: workId,
      title: `Catalog ${tagName}`,
      status: 'published',
      originKind: 'admin_text',
      publishedAt: new Date(),
    });
    await db.insert(readingPartTable).values({
      id: randomUUID(),
      workId,
      sortOrder: 0,
      kind: 'body',
      title: 'Body',
      body: '<p>Enough body text for publish checks.</p>',
    });
    await db.insert(tagTable).values({ id: tagId, name: tagName, normalized: normalizeTag(tagName) });
    await db.insert(readingWorkTagTable).values({ workId, tagId, provenance: 'manual' });

    return workId;
  }

  it('hides tags in API projection while status=processing but preserves manual junction', async () => {
    const workId = randomUUID();
    const tagId = randomUUID();
    workIds.push(workId);
    tagIds.push(tagId);

    await db.insert(readingWorkTable).values({
      id: workId,
      title: 'Re-parse Book',
      status: 'processing',
      originKind: 'admin_epub',
    });
    await db.insert(tagTable).values({ id: tagId, name: 'Kept Manual', normalized: normalizeTag('Kept Manual') });
    await db.insert(readingWorkTagTable).values({ workId, tagId, provenance: 'manual' });

    const response = await app.request(`/api/admin/works/${workId}`, { headers: { Cookie: adminCookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tags: string[];
      metadataProvenance: Record<string, string | undefined>;
    };
    expect(body.tags).toEqual([]);
    expect(body.metadataProvenance.tags).toBeUndefined();

    const junction = await db.select().from(readingWorkTagTable).where(eq(readingWorkTagTable.workId, workId));
    expect(junction).toHaveLength(1);
  });

  it('filters published catalog by junction tag SSOT', async () => {
    await seedPublishedWorkWithTag('SSOT-Unique-Tag');

    const response = await app.request('/api/catalog/works?tag=SSOT-Unique-Tag');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ title: string }> };
    expect(body.items.some((item) => item.title === 'Catalog SSOT-Unique-Tag')).toBe(true);
  });
});
