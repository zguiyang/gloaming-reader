import { and, eq } from 'drizzle-orm';

import {
  readingWork as readingWorkTable,
  readingWorkSource as readingWorkSourceTable,
  readingWorkTag as readingWorkTagTable,
  source as sourceTable,
} from '@gloaming/db';

import { db } from '@/db';
import { rootLogger } from '@/lib/logger';
import { cleanBookTitle, cleanDescription, joinAuthors } from '@/modules/epub-ingest/metadata';

const fillLogger = rootLogger.child({ module: 'MetadataFill' });

type WorkRow = typeof readingWorkTable.$inferSelect;

type ParsedSnapshot = {
  opfTitle?: string;
  authors?: string[];
  description?: string;
  language?: string;
  subjects?: string[];
  sourceRaw?: string;
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
    subjects: Array.isArray(row.subjects) ? row.subjects.filter((s): s is string => typeof s === 'string') : undefined,
    sourceRaw: typeof row.sourceRaw === 'string' ? row.sourceRaw : undefined,
  };
}

function matchSourceRule(raw: string, rule: string): boolean {
  const needle = rule.toLowerCase().trim();
  if (!needle) return false;
  const haystack = raw.toLowerCase();
  if (haystack.includes(needle)) return true;
  try {
    const host = new URL(raw).hostname;
    if (host.includes(needle) || needle.includes(host)) return true;
  } catch {
    // raw is not a URL — keyword matching above already ran
  }
  return false;
}

/**
 * Rule layer of the metadata pipeline — writes title/author/description/language
 * plus extracted source associations. Subject strings remain in originMeta as
 * candidates for the AI adjudication step; no rule-derived tag becomes final
 * metadata here. Failures must be swallowed by the caller (content is ready).
 */
export async function fillWorkMetadata(workId: string): Promise<void> {
  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  if (!work) {
    throw new Error(`Work ${workId} not found`);
  }
  if (work.originKind !== 'admin_epub') {
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

    // Rule subjects are AI hints only. Remove old extracted associations so a
    // re-run cannot leave stale rule-derived tags behind.
    await tx
      .delete(readingWorkTagTable)
      .where(and(eq(readingWorkTagTable.workId, workId), eq(readingWorkTagTable.provenance, 'extracted')));
    // Source: dc:source → match_rule association (extracted), else left empty.
    await tx
      .delete(readingWorkSourceTable)
      .where(and(eq(readingWorkSourceTable.workId, workId), eq(readingWorkSourceTable.provenance, 'extracted')));
    if (parsed.sourceRaw) {
      const sources = await tx.select().from(sourceTable);
      const matched = sources.find((s) => s.matchRule && matchSourceRule(parsed.sourceRaw!, s.matchRule));
      if (matched) {
        await tx
          .insert(readingWorkSourceTable)
          .values({ workId, sourceId: matched.id, provenance: 'extracted' })
          .onConflictDoNothing();
      }
    }

    await tx.update(readingWorkTable).set(patch).where(eq(readingWorkTable.id, workId));
  });

  fillLogger.info({ workId, title, sourceRaw: parsed.sourceRaw }, 'Metadata fill complete');
}
