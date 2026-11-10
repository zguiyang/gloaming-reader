import { eq } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@gloaming/db';

import { cleanBookTitle, cleanDescription, joinAuthors } from '@/domains/ingest/epub';
import { db } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';

const fillLogger = rootLogger.child({ module: 'MetadataFill' });

type WorkRow = typeof readingWorkTable.$inferSelect;

type ParsedSnapshot = {
  opfTitle?: string;
  authors?: string[];
  description?: string;
  language?: string;
};

function parsedSnapshot(work: WorkRow): ParsedSnapshot | undefined {
  const parsed = (work.originMeta as Record<string, unknown> | undefined)?.parsed;
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const row = parsed as Record<string, unknown>;
  return {
    opfTitle: typeof row.opfTitle === 'string' ? row.opfTitle : undefined,
    authors: Array.isArray(row.authors) ? row.authors.filter((a): a is string => typeof a === 'string') : undefined,
    description: typeof row.description === 'string' ? row.description : undefined,
    language: typeof row.language === 'string' ? row.language : undefined,
  };
}

/**
 * Rule layer of the metadata pipeline — writes title, author, description, and
 * language. Failures must be swallowed by the caller (content is ready).
 */
export async function fillWorkMetadata(workId: string): Promise<void> {
  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  if (!work) {
    throw new Error(`Work ${workId} not found`);
  }
  if (work.ownerUserId !== null || work.visibility !== 'catalog') {
    return;
  }
  const parsed = parsedSnapshot(work);
  if (!parsed) {
    return;
  }

  // Merge semantics: fill empty fields only — hand-edited values (title,
  // author, description) survive every parse. First-parse placeholder titles
  // are cleared by content-parse before this job runs.
  const parsedTitle = cleanBookTitle(parsed.opfTitle ?? '');
  const title = work.title || parsedTitle;
  const author = work.author || joinAuthors(parsed.authors ?? []);
  const cleanDesc = cleanDescription(parsed.description ?? '');
  const description = work.description || cleanDesc;
  const language = parsed.language ?? work.language;

  await db.transaction(async (tx) => {
    const patch: Partial<typeof readingWorkTable.$inferInsert> = {
      title,
      author,
      description,
      language,
    };

    if (cleanDesc) {
      const keepsExisting = Boolean(work.description && work.description !== cleanDesc);
      if (keepsExisting) {
        // A kept value is never "extracted". Preserve existing ai/manual
        // semantics (AI-filled descriptions survive re-parse untouched) and
        // only fall back to manual when nothing is recorded yet.
        if (!work.descriptionProvenance || work.descriptionProvenance === 'extracted') {
          patch.descriptionProvenance = 'manual';
        }
      } else {
        patch.descriptionProvenance = 'extracted';
      }
    }

    await tx.update(readingWorkTable).set(patch).where(eq(readingWorkTable.id, workId));
  });

  fillLogger.info({ workId, title }, 'Metadata fill complete');
}
