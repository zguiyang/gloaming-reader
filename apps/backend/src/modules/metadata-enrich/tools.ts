import { desc, eq, ilike, sql } from 'drizzle-orm';
import { tool } from 'langchain/tools';
import { z } from 'zod';

import { category as categoryTable, readingWorkTag as readingWorkTagTable, tag as tagTable } from '@gloaming/db';
import { optionalLocalizedText } from '@gloaming/shared/taxonomy';

import { db } from '@/db';
import { normalizeTag } from '@/lib/text';
import { supportedLocalesLabel } from '@/modules/metadata-enrich/taxonomy-localized';

const MAX_TOOL_RESULTS = 20;

/**
 * Global tag catalog on demand — the full tag table never enters the prompt.
 * No query → top-N by association count; with query → fuzzy (normalized) match.
 * Returns ids so the model can set `{ id, name }` for reuse (or `id: null` to create).
 */
export function listExistingTagsTool() {
  return tool(
    async ({ query, limit = 10 }: { query?: string; limit?: number }) => {
      const take = Math.min(Math.max(limit, 1), MAX_TOOL_RESULTS);
      if (query) {
        const needle = normalizeTag(query);
        const rows = await db
          .select({
            id: tagTable.id,
            name: tagTable.name,
            localizedNames: tagTable.localizedNames,
            usage: sql<number>`count(${readingWorkTagTable.tagId})`,
          })
          .from(tagTable)
          .leftJoin(readingWorkTagTable, eq(readingWorkTagTable.tagId, tagTable.id))
          .where(ilike(tagTable.normalized, `%${needle}%`))
          .groupBy(tagTable.id, tagTable.name, tagTable.localizedNames)
          .orderBy(desc(sql`count(${readingWorkTagTable.tagId})`))
          .limit(take);
        return JSON.stringify({
          tags: rows.map((r) => ({
            id: r.id,
            name: r.name,
            localizedNames: optionalLocalizedText(r.localizedNames),
            usage: Number(r.usage),
          })),
        });
      }
      const rows = await db
        .select({
          id: tagTable.id,
          name: tagTable.name,
          localizedNames: tagTable.localizedNames,
          usage: sql<number>`count(${readingWorkTagTable.tagId})`,
        })
        .from(tagTable)
        .leftJoin(readingWorkTagTable, eq(readingWorkTagTable.tagId, tagTable.id))
        .groupBy(tagTable.id, tagTable.name, tagTable.localizedNames)
        .orderBy(desc(sql`count(${readingWorkTagTable.tagId})`), tagTable.name)
        .limit(take);
      return JSON.stringify({
        tags: rows.map((r) => ({
          id: r.id,
          name: r.name,
          localizedNames: optionalLocalizedText(r.localizedNames),
          usage: Number(r.usage),
        })),
      });
    },
    {
      name: 'list_existing_tags',
      description: `List existing tags with localizedNames when present. Supported locales only: ${supportedLocalesLabel()}. Prefer { id, name, localizedNames } with a returned id; use id:null when nothing fits.`,
      schema: z.object({
        query: z.string().optional().describe('Optional search term for existing tags'),
        limit: z.number().int().min(1).max(MAX_TOOL_RESULTS).optional().describe('Max results'),
      }),
    },
  );
}

/** Category catalog on demand — same reuse-or-create contract as tags. */
export function listCategoriesTool() {
  return tool(
    async () => {
      const rows = await db
        .select({ id: categoryTable.id, name: categoryTable.name, localizedNames: categoryTable.localizedNames })
        .from(categoryTable)
        .orderBy(categoryTable.name);
      return JSON.stringify({
        categories: rows.map((r) => ({
          id: r.id,
          name: r.name,
          localizedNames: optionalLocalizedText(r.localizedNames),
        })),
      });
    },
    {
      name: 'list_categories',
      description: `List existing categories with localizedNames when present. Supported locales only: ${supportedLocalesLabel()}. Prefer { id, name, localizedNames } with a returned id; use id:null when nothing fits (server creates it). Always call before choosing a category.`,
      schema: z.object({}),
    },
  );
}
