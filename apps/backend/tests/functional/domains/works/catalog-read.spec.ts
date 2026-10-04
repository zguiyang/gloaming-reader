import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { readingWork as readingWorkTable } from '@gloaming/db';
import { catalogListDataSchema, workSchema } from '@gloaming/shared/works';

import app from '@/app';
import { db } from '@/infra/db';

import { createCatalogWorkFixture } from '../../../helpers/catalog-work-fixture';

describe('Catalog Work read APIs', () => {
  const workIds: string[] = [];

  afterAll(async () => {
    for (const workId of workIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
  });

  it('lists and reads published Works without Catalog taxonomy fields', async () => {
    const fixture = await createCatalogWorkFixture({ title: `Catalog Read ${Date.now()}` });
    workIds.push(fixture.id);

    const listResponse = await app.request(`/api/catalog/works?q=${encodeURIComponent(fixture.title)}`);
    expect(listResponse.status).toBe(200);
    const list = catalogListDataSchema.parse(await listResponse.json());
    expect(list.items.map((item) => item.id)).toContain(fixture.id);
    expect(list.items.find((item) => item.id === fixture.id)).not.toHaveProperty('tags');
    expect(list.items.find((item) => item.id === fixture.id)).not.toHaveProperty('category');
    expect(list.items.find((item) => item.id === fixture.id)).not.toHaveProperty('sources');

    const detailResponse = await app.request(`/api/catalog/works/${fixture.id}`);
    expect(detailResponse.status).toBe(200);
    const detail = workSchema.parse(await detailResponse.json());
    expect(detail.id).toBe(fixture.id);
    expect(detail).not.toHaveProperty('tags');
    expect(detail).not.toHaveProperty('category');
    expect(detail).not.toHaveProperty('sources');
  });
});
