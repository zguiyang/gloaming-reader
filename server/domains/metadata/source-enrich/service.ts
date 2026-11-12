import { and, eq, sql } from 'drizzle-orm';

import { workCoverRefreshJobId } from '@/jobs/work-cover-refresh';
import { readingWork as readingWorkTable } from '@/server/db';
import type { SourceRecordItem } from '@/shared/discovery';
import { PROJECT_GUTENBERG_SOURCE_KEY } from '@/server/domains/discovery/gutenberg/constants';
import { getGutenbergOpdsRecord, listGutenbergOpdsRecords } from '@/server/domains/discovery/gutenberg/opds-adapter';
import { upsertSourceRecordFromDetail } from '@/server/domains/discovery/persist/source-record';
import { isDiscoverySourceEnabled } from '@/server/domains/discovery/sources/service';
import { cleanDescription, joinAuthors } from '@/server/domains/ingest/epub';
import { db } from '@/server/infra/db';
import { rootLogger } from '@/server/infra/logging/logger';
import { enqueueWorkCoverRefresh } from '@/server/infra/queue';

import { isEmptyOrWeakDescription, pickConfidentMatch } from './match';

const enrichLogger = rootLogger.child({ module: 'SourceMetadataEnrich' });

export type SourceMetadataEnrichResult =
  | { ok: true; outcome: 'skipped'; reason: string }
  | { ok: true; outcome: 'missed' }
  | { ok: true; outcome: 'enriched'; externalId: string; sourceKey: string };

function buildSearchQuery(title: string, author: string): string {
  return [title.trim(), author.trim()].filter(Boolean).join(' ').trim();
}

function candidateAuthors(item: SourceRecordItem): string[] {
  return item.authors.map((author) => author.name).filter(Boolean);
}

/**
 * After a personal EPUB is ready, search enabled OPDS sources by title(+author)
 * and fill empty/weak metadata. Miss → no-op. Never replaces the user's EPUB.
 */
export async function enrichPersonalWorkFromSources(workId: string): Promise<SourceMetadataEnrichResult> {
  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  if (!work) {
    return { ok: true, outcome: 'skipped', reason: 'work_missing' };
  }
  if (work.originKind !== 'user_epub' || work.ownerUserId === null) {
    return { ok: true, outcome: 'skipped', reason: 'not_personal_upload' };
  }
  if (work.processingStatus === 'failed') {
    return { ok: true, outcome: 'skipped', reason: 'work_failed' };
  }

  const existingMatch = work.originMeta?.opdsMatch;
  if (existingMatch && typeof existingMatch === 'object' && existingMatch !== null) {
    const externalId = (existingMatch as { externalId?: unknown }).externalId;
    if (typeof externalId === 'string' && externalId.length > 0) {
      return { ok: true, outcome: 'skipped', reason: 'already_matched' };
    }
  }

  const title = work.title.trim();
  const author = (work.author ?? '').trim();
  const query = buildSearchQuery(title, author);
  if (!query) {
    return { ok: true, outcome: 'skipped', reason: 'empty_title' };
  }

  if (!(await isDiscoverySourceEnabled(PROJECT_GUTENBERG_SOURCE_KEY))) {
    return { ok: true, outcome: 'skipped', reason: 'source_disabled' };
  }

  const list = await listGutenbergOpdsRecords({
    q: query,
    page: 1,
    pageSize: 25,
  });

  const match = pickConfidentMatch(
    title,
    author,
    list.items.map((item) => ({
      externalId: item.externalId,
      title: item.title,
      authors: candidateAuthors(item),
    })),
  );
  if (!match) {
    enrichLogger.info({ workId, query }, 'Source metadata enrich missed');
    return { ok: true, outcome: 'missed' };
  }

  const detail = await getGutenbergOpdsRecord(match.externalId);
  // Cache OPDS metadata without linking the personal Work to the SourceRecord.
  await upsertSourceRecordFromDetail(detail);

  const patch: {
    description?: string;
    descriptionProvenance?: 'extracted';
    language?: string;
    author?: string;
  } = {};

  const sourceDescription = cleanDescription(detail.description ?? '');
  if (sourceDescription && isEmptyOrWeakDescription(work.description)) {
    patch.description = sourceDescription;
    patch.descriptionProvenance = 'extracted';
  }

  const sourceLanguage = detail.languages[0]?.trim();
  if (sourceLanguage && (!work.language || work.language === 'und')) {
    patch.language = sourceLanguage;
  }

  const sourceAuthor = joinAuthors(candidateAuthors(detail));
  if (sourceAuthor && !author) {
    patch.author = sourceAuthor;
  }

  const matchedAt = new Date().toISOString();
  const opdsMatch = {
    sourceKey: PROJECT_GUTENBERG_SOURCE_KEY,
    externalId: match.externalId,
    matchedAt,
  };

  await db
    .update(readingWorkTable)
    .set({
      ...patch,
      originMeta: sql`${readingWorkTable.originMeta} || ${JSON.stringify({ opdsMatch })}::jsonb`,
    })
    .where(and(eq(readingWorkTable.id, workId), eq(readingWorkTable.originKind, 'user_epub')));

  if (!work.coverAssetId && detail.coverUrl) {
    try {
      await enqueueWorkCoverRefresh(
        { workId, sourceCoverUrl: detail.coverUrl },
        {
          attempts: 2,
          jobId: workCoverRefreshJobId(workId, detail.coverUrl),
        },
      );
    } catch (error) {
      enrichLogger.warn({ err: error, workId }, 'Failed to enqueue personal cover refresh after OPDS match');
    }
  }

  enrichLogger.info(
    { workId, sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, externalId: match.externalId },
    'Source metadata enrich applied',
  );
  return {
    ok: true,
    outcome: 'enriched',
    externalId: match.externalId,
    sourceKey: PROJECT_GUTENBERG_SOURCE_KEY,
  };
}
