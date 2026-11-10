/**
 * Idempotent development fixture: ensures one published Catalog Work for Discover → Reader.
 * Run: pnpm --filter @gloaming/backend seed:dev
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';

import { db } from '../src/infra/db/index.ts';

const SEED_TITLE = '[dev-seed] Morning Light';

const SEED_BODY = `The first light touched the water before anyone else was awake.

A fisherman named Elias stood at the pier with his coffee, watching the harbor wake in slow motion. Gulls argued over scraps. Ropes creaked against wood.

He had read the same paragraph in an old magazine the night before—something about patience and small habits. It sounded simple until the morning made it real.

When the sun cleared the rooflines, Elias decided he would read one more page before work. Just one. Then another if the day allowed.

The sea did not hurry. Neither would he.`;

async function main() {
  const [existing] = await db
    .select({
      id: readingWorkTable.id,
      publishedAt: readingWorkTable.publishedAt,
    })
    .from(readingWorkTable)
    .where(eq(readingWorkTable.title, SEED_TITLE))
    .limit(1);

  if (existing?.publishedAt) {
    console.log(`Dev seed work already published: ${existing.id}`);
    process.exit(0);
  }

  const workId = existing?.id ?? randomUUID();
  if (!existing) {
    await db.insert(readingWorkTable).values({
      id: workId,
      title: SEED_TITLE,
      processingStatus: 'ready',
      visibility: 'catalog',
      ownerUserId: null,
      publishedAt: new Date(),
    });
    await db.insert(readingPartTable).values({
      id: randomUUID(),
      workId,
      sortOrder: 0,
      kind: 'body',
      title: SEED_TITLE,
      body: SEED_BODY,
    });
    console.log(`Created development fixture: ${workId}`);
  } else {
    await db
      .update(readingWorkTable)
      .set({ processingStatus: 'ready', visibility: 'catalog', ownerUserId: null, publishedAt: new Date() })
      .where(eq(readingWorkTable.id, workId));
  }
  console.log(`Development fixture is available in Discover: ${workId} — "${SEED_TITLE}"`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('Dev seed failed:', error);
  process.exit(1);
});
