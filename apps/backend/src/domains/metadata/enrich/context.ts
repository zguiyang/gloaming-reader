import { asc, eq } from 'drizzle-orm';

import { readingPart as readingPartTable } from '@gloaming/db';

import { EXCERPT_MAX_CHARS, TOC_TITLE_MAX } from '@/domains/metadata/enrich/prompt';
import { db } from '@/infra/db';

export type BookContext = { excerpt: string; tocTitles: string[] };

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCountOf(text: string): number {
  return stripHtml(text).split(/\s+/).filter(Boolean).length;
}

export async function loadBookContext(workId: string): Promise<BookContext> {
  const parts = await db
    .select({ title: readingPartTable.title, body: readingPartTable.body })
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId))
    .orderBy(asc(readingPartTable.sortOrder), asc(readingPartTable.id));
  const tocTitles = parts
    .map((part) => part.title.trim())
    .filter(Boolean)
    .slice(0, TOC_TITLE_MAX);
  const target = parts.find((part) => wordCountOf(part.body) >= 100) ?? parts[0];
  const excerpt = target ? stripHtml(target.body).slice(0, EXCERPT_MAX_CHARS) : '';
  return { excerpt, tocTitles };
}
