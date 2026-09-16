import { eq } from 'drizzle-orm';

import { source as sourceTable, tag as tagTable } from '@gloaming/db';

import { db } from '@/db';
import { normalizeTag } from '@/lib/text';

export async function ensureWorkTaxonomyFixture(label: string): Promise<{
  sources: [{ id: string }];
  tags: [{ id: string }];
}> {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const tagId = `vitest-tag-${slug}`;
  const sourceId = `vitest-source-${slug}`;
  const tagName = `Vitest ${label} tag`;
  const sourceName = `Vitest ${label} source`;

  await db
    .insert(tagTable)
    .values({
      id: tagId,
      name: tagName,
      localizedNames: { 'en-US': tagName },
      normalized: normalizeTag(tagName),
      origin: 'manual',
    })
    .onConflictDoNothing();
  await db
    .insert(sourceTable)
    .values({ id: sourceId, name: sourceName, origin: 'manual', matchRule: '' })
    .onConflictDoNothing();

  const [tag] = await db.select({ id: tagTable.id }).from(tagTable).where(eq(tagTable.id, tagId)).limit(1);
  const [source] = await db
    .select({ id: sourceTable.id })
    .from(sourceTable)
    .where(eq(sourceTable.id, sourceId))
    .limit(1);
  if (!tag || !source) {
    throw new Error(`Unable to create taxonomy fixture for ${label}`);
  }

  return { sources: [{ id: source.id }], tags: [{ id: tag.id }] };
}
