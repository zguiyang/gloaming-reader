/**
 * Idempotent dev seed: ensures at least one published work for Discover → Reader.
 * Run: pnpm --filter @gloaming/backend seed:dev
 */
import { eq } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@gloaming/db';

import { db } from '../src/db/index.ts';
import { publishWork } from '../src/modules/works/admin/admin-lifecycle.ts';
import { createAdminTextWork, updateWork } from '../src/modules/works/service.ts';

const SEED_TITLE = '[dev-seed] Morning Light';

const SEED_BODY = `The first light touched the water before anyone else was awake.

A fisherman named Elias stood at the pier with his coffee, watching the harbor wake in slow motion. Gulls argued over scraps. Ropes creaked against wood.

He had read the same paragraph in an old magazine the night before—something about patience and small habits. It sounded simple until the morning made it real.

When the sun cleared the rooflines, Elias decided he would read one more page before work. Just one. Then another if the day allowed.

The sea did not hurry. Neither would he.`;

async function main() {
  const [existing] = await db
    .select({ id: readingWorkTable.id, status: readingWorkTable.status })
    .from(readingWorkTable)
    .where(eq(readingWorkTable.title, SEED_TITLE))
    .limit(1);

  if (existing?.status === 'published') {
    console.log(`Dev seed work already published: ${existing.id}`);
    process.exit(0);
  }

  let workId = existing?.id;
  if (!workId) {
    const created = await createAdminTextWork({
      title: SEED_TITLE,
      body: SEED_BODY,
    });
    workId = created.id;
    console.log(`Created draft work: ${workId}`);
  }

  await updateWork(workId, {
    sources: ['Dev Seed'],
    tags: ['story', 'daily-life'],
  });

  const published = await publishWork(workId);
  console.log(`Published dev seed work: ${published.id} — "${published.title}"`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('Dev seed failed:', error);
  process.exit(1);
});
