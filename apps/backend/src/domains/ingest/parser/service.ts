import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  type ContentAssetMeta,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
} from '@gloaming/db';

import { parserFor } from '@/domains/ingest/parser/registry';
import type { ParsedContent } from '@/domains/ingest/parser/types';
import { resetParseStepOutputs } from '@/domains/ingest/reset/service';
import { workflowClaimWhere } from '@/domains/works/lifecycle';
import { db } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';
import { getObject, putObject } from '@/infra/storage';

import { type ImageOptimizeResult, optimizeIngestImage } from './image-optimizer';
import {
  coverKey,
  deleteParseArtifactKeys,
  imageKey,
  parseArtifactManifests,
  registerParseArtifactManifest,
  sha256,
} from './parse-artifacts';
import { type ParseWorkflowLease, ParseWorkflowLeaseLostError, startParseWorkflowLease } from './parse-workflow-lease';

const ingestLogger = rootLogger.child({ module: 'ContentParser' });

/** Max images extracted per book (abuse / runaway protection). */
const MAX_BOOK_IMAGES = 200;

type WorkRow = typeof readingWorkTable.$inferSelect;

export type ContentParsePersisted = {
  workId: string;
  isPersonalWork: boolean;
  hasParsedBefore: boolean;
  parsedLanguage: string;
  preserveManualStats: boolean;
  partBodies: { body: string }[];
  parsedMeta: Record<string, unknown>;
  coverAssetId: string | null;
  placeholderTitle: string;
  placeholderAuthor: string;
  placeholderDescription: string;
};

async function loadOriginAsset(workId: string): Promise<{ body: Buffer; contentType: string }> {
  const [asset] = await db
    .select({ storageKey: contentAssetTable.storageKey, contentType: contentAssetTable.mimeType })
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
  return { body: object.body, contentType: asset.contentType };
}

function ingestImageAssetMeta(originalPath: string, optimized: ImageOptimizeResult): ContentAssetMeta {
  return {
    originalPath,
    size: optimized.finalByteLength,
    sourceMimeType: optimized.originalMime,
    sourceSize: optimized.originalByteLength,
    transform: optimized.transform,
    transformVersion: optimized.transformVersion,
  };
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
 * Parse origin bytes, store parts/images/cover, and persist parse metadata under an
 * active workflow claim. Does not update reading statistics or workflow status.
 */
export async function runContentParse(
  work: WorkRow,
  jobToken: string,
  attemptToken: string,
  lease: ParseWorkflowLease,
): Promise<ContentParsePersisted | false> {
  const workId = work.id;
  const uploadedKeys: string[] = [];
  try {
    await lease.ensureOwned();

    const previousArtifacts = parseArtifactManifests(work.originMeta)
      .filter((manifest) => manifest.attemptToken !== attemptToken)
      .flatMap((manifest) => manifest.keys);
    if (previousArtifacts.length > 0) {
      await deleteParseArtifactKeys(previousArtifacts);
    }

    const originAsset = await loadOriginAsset(workId);
    const parser = parserFor(originAsset.contentType);
    const content = await parser.parse(originAsset.body);
    await lease.ensureOwned();

    if (content.chapters.length === 0) {
      throw new Error(`${originAsset.contentType} produced no readable chapters`);
    }

    const chapterHtml = content.chapters.map((chapter) => chapter.html).join('\n');
    const usedImages = content.images.filter((image) => chapterHtml.includes(image.token)).slice(0, MAX_BOOK_IMAGES);

    const imageDrafts = await Promise.all(
      usedImages.map(async (image) => {
        const sourceHash = sha256(image.bytes);
        const optimized = await optimizeIngestImage({ bytes: image.bytes, mime: image.mime });
        return {
          id: randomUUID(),
          image,
          sourceHash,
          optimized,
          key: imageKey(workId, attemptToken, sourceHash, optimized.mime),
        };
      }),
    );
    const coverDraft = content.cover
      ? await (async () => {
          const sourceHash = sha256(content.cover!.bytes);
          const optimized = await optimizeIngestImage({ bytes: content.cover!.bytes, mime: content.cover!.mime });
          return {
            id: randomUUID(),
            cover: content.cover!,
            sourceHash,
            optimized,
            key: coverKey(workId, attemptToken, sourceHash, optimized.mime),
          };
        })()
      : null;
    const plannedKeys = [...imageDrafts.map((draft) => draft.key), ...(coverDraft ? [coverDraft.key] : [])];

    await resetParseStepOutputs(work, { retryJobToken: jobToken, attemptToken });
    if (!(await registerParseArtifactManifest(workId, jobToken, attemptToken, plannedKeys))) {
      throw new ParseWorkflowLeaseLostError();
    }

    const hrefToAssetId = new Map<string, string>();
    for (const draft of imageDrafts) {
      await lease.ensureOwned();
      await putObject({ key: draft.key, body: draft.optimized.bytes, contentType: draft.optimized.mime });
      uploadedKeys.push(draft.key);
      await lease.ensureOwned();
      hrefToAssetId.set(draft.image.href, draft.id);
    }

    if (coverDraft && content.cover) {
      await lease.ensureOwned();
      await putObject({
        key: coverDraft.key,
        body: coverDraft.optimized.bytes,
        contentType: coverDraft.optimized.mime,
      });
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
    const hasParsedBefore = Boolean(work.originMeta?.parsed);
    const metadata = content.metadata;
    const parsedMeta = {
      opfTitle: metadata.title,
      authors: metadata.authors,
      description: metadata.description,
      language: metadata.language,
      coverHref: content.cover?.originalPath ?? null,
      spineCount: content.stats.spineCount,
      navCount: content.stats.navCount,
      chapterCount: content.stats.chapterCount,
      imageCount: imageDrafts.length,
      parsedAt: new Date().toISOString(),
    };

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
          mimeType: draft.optimized.mime,
          contentHash: draft.sourceHash,
          meta: ingestImageAssetMeta(draft.image.href, draft.optimized),
          status: 'ready',
        });
      }
      if (coverDraft && content.cover) {
        await tx.insert(contentAssetTable).values({
          id: coverDraft.id,
          workId,
          kind: 'cover',
          storageKey: coverDraft.key,
          mimeType: coverDraft.optimized.mime,
          contentHash: coverDraft.sourceHash,
          meta: ingestImageAssetMeta(content.cover.originalPath, coverDraft.optimized),
          status: 'ready',
        });
      }
      await tx.delete(readingPartTable).where(eq(readingPartTable.workId, workId));
      for (let i = 0; i < content.chapters.length; i += 1) {
        const chapter = content.chapters[i]!;
        const body = partBodies[i]!.body;
        await tx.insert(readingPartTable).values({
          id: randomUUID(),
          workId,
          sortOrder: i,
          kind: 'chapter',
          title: chapter.title.slice(0, 200),
          body,
          meta: {},
        });
      }
      const [committed] = await tx
        .update(readingWorkTable)
        .set({
          title: hasParsedBefore ? work.title : '',
          author: hasParsedBefore ? work.author : '',
          description: hasParsedBefore ? work.description : '',
          coverAssetId: coverDraft?.id ?? null,
          publishedAt: null,
          originMeta: sql`(${readingWorkTable.originMeta} - 'failedStep' - 'lastError' - 'failedAt') || ${JSON.stringify({ parsed: parsedMeta })}::jsonb`,
        })
        .where(workflowClaimWhere(workId, 'parse', jobToken, attemptToken))
        .returning({ id: readingWorkTable.id });
      if (!committed) {
        throw new ParseWorkflowLeaseLostError();
      }
    });

    ingestLogger.info(
      { workId, chapters: content.chapters.length, images: imageDrafts.length },
      'Content parse persistence complete',
    );
    return {
      workId,
      isPersonalWork: work.originKind === 'user_epub',
      hasParsedBefore,
      parsedLanguage,
      preserveManualStats: work.statsProvenance === 'manual',
      partBodies,
      parsedMeta,
      coverAssetId: coverDraft?.id ?? null,
      placeholderTitle: work.title,
      placeholderAuthor: work.author,
      placeholderDescription: work.description,
    };
  } catch (error) {
    ingestLogger.error({ err: error, workId }, 'Content parse failed');
    await deleteParseArtifactKeys(uploadedKeys);
    if (error instanceof ParseWorkflowLeaseLostError || lease.isLeaseLost()) {
      return false;
    }
    throw error;
  }
}

export { ParseWorkflowLeaseLostError, startParseWorkflowLease };
export type { WorkRow as ContentWorkRow, ParseWorkflowLease };
