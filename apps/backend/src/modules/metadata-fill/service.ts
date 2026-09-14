import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import {
  readingWork as readingWorkTable,
  readingWorkSource as readingWorkSourceTable,
  readingWorkTag as readingWorkTagTable,
  source as sourceTable,
  tag as tagTable,
} from '@gloaming/db';
import type { LocalizedTextMap } from '@gloaming/shared/taxonomy';

import { db } from '@/db';
import { rootLogger } from '@/lib/logger';
import { normalizeTag } from '@/lib/text';
import { cleanBookTitle, cleanDescription, joinAuthors } from '@/modules/epub-ingest/metadata';
import { inferLocaleForLabel, mergeTaxonomyLocalizedNames } from '@/modules/metadata-enrich/taxonomy-localized';
import { cleanSubjectsToProductTags } from '@/modules/metadata-fill/subjects';

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
 * plus extracted tag/source associations. Idempotent: extracted associations
 * are deleted then re-inserted; manual/ai rows are never touched. On success
 * originMeta is left untouched (the parsed snapshot is the audit record).
 * Failures must be swallowed by the caller (content is already ready).
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

  // Raw subjects stay in originMeta.parsed; only bookstore-style names become tags.
  const productTags = cleanSubjectsToProductTags(parsed.subjects ?? []);

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

    // Tags: cleaned subjects → extracted associations (re-insert idempotent).
    await tx
      .delete(readingWorkTagTable)
      .where(and(eq(readingWorkTagTable.workId, workId), eq(readingWorkTagTable.provenance, 'extracted')));
    for (const name of productTags) {
      const normalized = normalizeTag(name);
      const locale = inferLocaleForLabel(name, language);
      const incoming: LocalizedTextMap = { [locale]: name };
      const [existing] = await tx.select().from(tagTable).where(eq(tagTable.normalized, normalized)).limit(1);
      let tagId: string;
      if (existing) {
        const localizedNames = mergeTaxonomyLocalizedNames(existing.localizedNames, incoming);
        await tx.update(tagTable).set({ name, localizedNames }).where(eq(tagTable.id, existing.id));
        tagId = existing.id;
      } else {
        const [row] = await tx
          .insert(tagTable)
          .values({ id: randomUUID(), name, normalized, localizedNames: incoming, origin: 'extracted' })
          .returning();
        tagId = row!.id;
      }
      await tx.insert(readingWorkTagTable).values({ workId, tagId, provenance: 'extracted' }).onConflictDoNothing();
    }

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

  fillLogger.info({ workId, title, tags: productTags.length, sourceRaw: parsed.sourceRaw }, 'Metadata fill complete');
}
