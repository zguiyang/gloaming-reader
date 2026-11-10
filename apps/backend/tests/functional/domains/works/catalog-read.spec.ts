import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { readingWork as readingWorkTable } from '@gloaming/db';
import { discoverySource as discoverySourceTable, sourceRecord as sourceRecordTable } from '@gloaming/db/schema';
import { catalogListDataSchema, workSchema } from '@gloaming/shared/works';

import app from '@/app';
import { db } from '@/infra/db';

import { createCatalogWorkFixture } from '../../../helpers/catalog-work-fixture';

describe('Catalog Work read APIs', () => {
  const workIds: string[] = [];
  const sourceIds: string[] = [];

  afterAll(async () => {
    for (const sourceId of sourceIds) {
      await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    }
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

  it('keeps the default Catalog list unchanged and excludes SourceRecord-linked Works only when asked', async () => {
    const marker = `SourceLink ${Date.now()}`;
    const linked = await createCatalogWorkFixture({ title: `${marker} linked` });
    const unlinked = await createCatalogWorkFixture({ title: `${marker} unlinked` });
    workIds.push(linked.id, unlinked.id);

    const sourceId = randomUUID();
    await db.insert(discoverySourceTable).values({
      id: sourceId,
      sourceKey: `catalog_read_${sourceId}`,
      sourceType: 'gutenberg_rdf',
    });
    sourceIds.push(sourceId);
    await db.insert(sourceRecordTable).values({
      id: randomUUID(),
      sourceId,
      externalId: `ext-${sourceId}`,
      title: 'Linked Source Record',
      authors: [],
      languages: ['en'],
      workId: linked.id,
    });

    const query = encodeURIComponent(marker);
    const defaultList = catalogListDataSchema.parse(
      await (await app.request(`/api/catalog/works?q=${query}&pageSize=50`)).json(),
    );
    expect(defaultList.items.map((item) => item.id)).toEqual(expect.arrayContaining([linked.id, unlinked.id]));

    const unlinkedOnly = catalogListDataSchema.parse(
      await (await app.request(`/api/catalog/works?q=${query}&sourceLink=unlinked&pageSize=50`)).json(),
    );
    const returnedIds = unlinkedOnly.items.map((item) => item.id);
    expect(returnedIds).toContain(unlinked.id);
    expect(returnedIds).not.toContain(linked.id);
  });

  it('rejects an unknown sourceLink value with a validation error', async () => {
    const response = await app.request('/api/catalog/works?sourceLink=unknown');
    expect(response.status).toBe(400);
  });
});
