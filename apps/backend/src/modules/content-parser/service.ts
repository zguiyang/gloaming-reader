import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
} from '@gloaming/db';

import { db } from '@/db';
import { rootLogger } from '@/lib/logger';
import { claimWorkflowStep, failWorkflowStep, workflowClaimWhere } from '@/lib/workflow';
import { WORKFLOW_AUTO_CHAIN } from '@/lib/workflow-policy';
import { parserFor } from '@/modules/content-parser/registry';
import type { ParsedContent } from '@/modules/content-parser/types';
import { resetParseStepOutputs } from '@/modules/ingest-reset/service';
import { getObject, putObject } from '@/modules/oss';
import { computePartReadingStats, computeWorkReadingStats } from '@/modules/reading-stats/service';

import {
  coverKey,
  deleteParseArtifactKeys,
  imageKey,
  parseArtifactManifests,
  registerParseArtifactManifest,
  sha256,
} from './parse-artifacts';
import { ParseWorkflowLeaseLostError, startParseWorkflowLease } from './parse-workflow-lease';

const ingestLogger = rootLogger.child({ module: 'ContentParser' });

/** Max images extracted per book (abuse / runaway protection). */
const MAX_BOOK_IMAGES = 200;

type WorkRow = typeof readingWorkTable.$inferSelect;

async function loadOriginBytes(workId: string): Promise<Buffer> {
  const [asset] = await db
    .select({ storageKey: contentAssetTable.storageKey })
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.workId, workId), eq(contentAssetTable.kind, 'origin_file')))
    .limit(1);
  if (!asset) {
    throw new Error(`Work ${workId} has no origin_file asset`);
  }
  const object = await getObject(asset.storageKey);
  if (!object) {
    throw new Error(`Origin file object missing: ${asset.storageKey}`);
  }
  return object.body;
}

/** Rewrite placeholder tokens to published asset URLs (or drop unresolved ones). */
function rewriteImageSrcs(html: string, images: ParsedContent['images'], hrefToAssetId: Map<string, string>): string {
  let out = html;
  for (const image of images) {
    const assetId = hrefToAssetId.get(image.href);
    if (assetId) {
      out = out.split(image.token).join(`/api/assets/${assetId}`);
    } else {
      out = out.split(image.token).join('');
    }
  }
  return out;
}

/**
 * Content ingest job — resolve the source parser, then store parts/images/cover
 * and update the work. Idempotent: re-running replaces parts + derived assets.
 * Claims the `parse` workflow step and moves the work to `metadata`
 * (auto-chain) or `parsed` (manual next) on success. Parse artifacts are
 * attempt-scoped until the owner commits them.
 */
export async function processContentWork(
  workId: string,
  retryJobToken?: string,
  attemptToken = randomUUID(),
): Promise<boolean> {
  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  if (!work) {
    throw new Error(`Work ${workId} not found`);
  }
  const existingToken = typeof work.originMeta.retryJobToken === 'string' ? work.originMeta.retryJobToken : undefined;
  const jobToken = retryJobToken ?? existingToken ?? randomUUID();
  if (!existingToken && !retryJobToken) {
    const [prepared] = await db
      .update(readingWorkTable)
      .set({ originMeta: sql`${readingWorkTable.originMeta} || ${JSON.stringify({ retryJobToken: jobToken })}::jsonb` })
      .where(
        and(
          eq(readingWorkTable.id, workId),
          eq(readingWorkTable.status, work.status),
          sql`coalesce(${readingWorkTable.originMeta}->>'retryJobToken', '') = ''`,
        ),
      )
      .returning({ id: readingWorkTable.id });
    if (!prepared) {
      return false;
    }
  }
  if (!(await claimWorkflowStep(workId, 'parse', jobToken, attemptToken))) {
    return false;
  }

  const lease = startParseWorkflowLease({
    workId,
    jobToken,
    attemptToken,
    logger: ingestLogger,
  });

  const uploadedKeys: string[] = [];
  try {
    await lease.ensureOwned();

    const previousArtifacts = parseArtifactManifests(work.originMeta)
      .filter((manifest) => manifest.attemptToken !== attemptToken)
      .flatMap((manifest) => manifest.keys);
    if (previousArtifacts.length > 0) {
      await deleteParseArtifactKeys(previousArtifacts);
    }

    const bytes = await loadOriginBytes(workId);
    const parser = parserFor(work.originKind);
    const content = await parser.parse(bytes);
    await lease.ensureOwned();

    if (content.chapters.length === 0) {
      throw new Error(`${work.originKind} produced no readable chapters`);
    }

    // Only store images referenced by chapters that survived planning — a
    // dropped cover page must not leak its image into the body image set.
    const chapterHtml = content.chapters.map((chapter) => chapter.html).join('\n');
    const usedImages = content.images.filter((image) => chapterHtml.includes(image.token)).slice(0, MAX_BOOK_IMAGES);

    const imageDrafts = usedImages.map((image) => {
      const hash = sha256(image.bytes);
      return {
        id: randomUUID(),
        image,
        hash,
        key: imageKey(workId, attemptToken, hash, image.mime),
      };
    });
    const coverDraft = content.cover
      ? {
          id: randomUUID(),
          key: coverKey(workId, attemptToken, content.cover.mime),
          hash: sha256(content.cover.bytes),
        }
      : null;
    const plannedKeys = [...imageDrafts.map((draft) => draft.key), ...(coverDraft ? [coverDraft.key] : [])];

    // Reset and publish only while the attempt owns a row lock. The manifest
    // is persisted before any upload so a later owner can safely collect it.
    await resetParseStepOutputs(work, { retryJobToken: jobToken, attemptToken });
    if (!(await registerParseArtifactManifest(workId, jobToken, attemptToken, plannedKeys))) {
      throw new ParseWorkflowLeaseLostError();
    }

    // Store objects first, but never expose them through asset rows until the
    // owner-scoped final transaction commits.
    const hrefToAssetId = new Map<string, string>();
    for (const draft of imageDrafts) {
      await lease.ensureOwned();
      await putObject({ key: draft.key, body: draft.image.bytes, contentType: draft.image.mime });
      uploadedKeys.push(draft.key);
      await lease.ensureOwned();
      hrefToAssetId.set(draft.image.href, draft.id);
    }

    if (coverDraft && content.cover) {
      await lease.ensureOwned();
      await putObject({ key: coverDraft.key, body: content.cover.bytes, contentType: content.cover.mime });
      uploadedKeys.push(coverDraft.key);
      await lease.ensureOwned();
    }

    const partBodies: { body: string }[] = [];
    for (let i = 0; i < content.chapters.length; i += 1) {
      const chapter = content.chapters[i]!;
      const body = rewriteImageSrcs(chapter.html, usedImages, hrefToAssetId);
      partBodies.push({ body });
    }

    const parsedLanguage = content.metadata.language ?? work.language;
    const workStats = computeWorkReadingStats(partBodies, parsedLanguage);
    const preserveManualStats = work.statsProvenance === 'manual';

    // Metadata: title/author/description/language land via the metadata-fill
    // job (rule layer). content-parse only decides first-parse vs re-parse:
    // on first parse the upload placeholder title (file name) is cleared so
    // fill can take the parsed value; on re-parse hand-edited values stay.
    const hasParsedBefore = Boolean(work.originMeta?.parsed);
    const metadata = content.metadata;

    await lease.ensureOwned();
    await db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: readingWorkTable.id })
        .from(readingWorkTable)
        .where(workflowClaimWhere(workId, 'parse', jobToken, attemptToken))
        .for('update');
      if (!owned) {
        throw new ParseWorkflowLeaseLostError();
      }
      for (const draft of imageDrafts) {
        await tx.insert(contentAssetTable).values({
          id: draft.id,
          workId,
          kind: 'image',
          storageKey: draft.key,
          mimeType: draft.image.mime,
          contentHash: draft.hash,
          meta: { originalPath: draft.image.href, size: draft.image.bytes.length },
          status: 'ready',
        });
      }
      if (coverDraft && content.cover) {
        await tx.insert(contentAssetTable).values({
          id: coverDraft.id,
          workId,
          kind: 'cover',
          storageKey: coverDraft.key,
          mimeType: content.cover.mime,
          contentHash: coverDraft.hash,
          meta: { originalPath: content.cover.originalPath, size: content.cover.bytes.length },
          status: 'ready',
        });
      }
      await tx.delete(readingPartTable).where(eq(readingPartTable.workId, workId));
      for (let i = 0; i < content.chapters.length; i += 1) {
        const chapter = content.chapters[i]!;
        const body = rewriteImageSrcs(chapter.html, usedImages, hrefToAssetId);
        const partStats = computePartReadingStats(body);
        await tx.insert(readingPartTable).values({
          id: randomUUID(),
          workId,
          sortOrder: i,
          kind: 'chapter',
          title: chapter.title.slice(0, 200),
          body,
          meta: { wordCount: partStats.wordCount },
        });
      }
      const parsed = {
        opfTitle: metadata.title,
        authors: metadata.authors,
        description: metadata.description,
        language: metadata.language,
        subjects: metadata.subjects,
        sourceRaw: metadata.sourceRaw,
        coverHref: content.cover?.originalPath ?? null,
        spineCount: content.stats.spineCount,
        navCount: content.stats.navCount,
        chapterCount: content.stats.chapterCount,
        imageCount: imageDrafts.length,
        parsedAt: new Date().toISOString(),
      };
      const [completed] = await tx
        .update(readingWorkTable)
        .set({
          title: hasParsedBefore ? work.title : '',
          author: hasParsedBefore ? work.author : '',
          description: hasParsedBefore ? work.description : '',
          coverAssetId: coverDraft?.id ?? null,
          wordCount: workStats.wordCount,
          estimatedMinutes: workStats.estimatedMinutes,
          ...(preserveManualStats
            ? {}
            : {
                suggestedVocabSize: workStats.suggestedVocabSize,
                difficultyScore: workStats.difficultyScore,
                statsProvenance: workStats.statsProvenance,
              }),
          status: WORKFLOW_AUTO_CHAIN ? 'metadata' : 'parsed',
          publishedAt: null,
          originMeta: WORKFLOW_AUTO_CHAIN
            ? sql`(${readingWorkTable.originMeta} - 'failedStep' - 'lastError' - 'failedAt' - 'workflowParseArtifacts') || ${JSON.stringify({ parsed })}::jsonb`
            : sql`(${readingWorkTable.originMeta} - 'failedStep' - 'lastError' - 'failedAt' - 'workflowClaimAttempt' - 'workflowClaimStep' - 'workflowClaimLeaseExpiresAt' - 'workflowParseArtifacts') || ${JSON.stringify({ parsed })}::jsonb`,
        })
        .where(workflowClaimWhere(workId, 'parse', jobToken, attemptToken))
        .returning({ id: readingWorkTable.id });
      if (!completed) {
        throw new ParseWorkflowLeaseLostError();
      }
    });

    ingestLogger.info(
      { workId, chapters: content.chapters.length, images: imageDrafts.length },
      'Content ingest complete',
    );
    return true;
  } catch (error) {
    ingestLogger.error({ err: error, workId }, 'Content ingest failed');
    await deleteParseArtifactKeys(uploadedKeys);
    if (error instanceof ParseWorkflowLeaseLostError || lease.isLeaseLost()) {
      return false;
    }
    await failWorkflowStep(workId, 'parse', jobToken, attemptToken, error);
    throw error;
  } finally {
    lease.stopHeartbeat();
  }
}

export type { WorkRow as ContentWorkRow };
