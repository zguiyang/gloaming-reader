import { and, eq, inArray } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  type readingPart as readingPartTable,
  type readingWork as readingWorkTable,
} from '@gloaming/db';
import { audioKindForRole, deriveAudioTrackStatus } from '@gloaming/shared/content-assets';
import type { SourceReference, TaxonomyReference } from '@gloaming/shared/taxonomy';
import type { PublishPartAudioGateInput, PublishWorkIssue } from '@gloaming/shared/works';
import { mergePublishWorkIssues, PUBLISH_DEFAULT_AUDIO_ROLE } from '@gloaming/shared/works';

import { db } from '@/db';
import { htmlToPlainText } from '@/lib/part-text';
import { hashPartAudioContent } from '@/modules/works/content-hash';

type WorkRow = typeof readingWorkTable.$inferSelect;
type PartRow = typeof readingPartTable.$inferSelect;

async function loadPublishPartAudioGateInputs(parts: PartRow[]): Promise<PublishPartAudioGateInput[]> {
  if (parts.length === 0) {
    return [];
  }
  const partIds = parts.map((part) => part.id);
  const defaultKind = audioKindForRole(PUBLISH_DEFAULT_AUDIO_ROLE);
  const audioRows = await db
    .select({
      partId: contentAssetTable.partId,
      status: contentAssetTable.status,
      contentHash: contentAssetTable.contentHash,
    })
    .from(contentAssetTable)
    .where(and(inArray(contentAssetTable.partId, partIds), eq(contentAssetTable.kind, defaultKind)));
  const assetByPartId = new Map(audioRows.filter((row) => row.partId != null).map((row) => [row.partId!, row]));

  return parts.map((part) => {
    const bodyPlain = htmlToPlainText(part.body);
    const currentContentHash = hashPartAudioContent(part.body);
    const asset = assetByPartId.get(part.id) ?? null;
    return {
      partId: part.id,
      partTitle: part.title,
      bodyPlain,
      defaultTrackStatus: deriveAudioTrackStatus(asset, currentContentHash),
    };
  });
}

/** Single source of truth for admin publish validation (gate + issue projection). */
export async function buildPublishIssuesForWork(
  row: WorkRow,
  partRows: PartRow[],
  tags: TaxonomyReference[],
  sources: SourceReference[],
): Promise<PublishWorkIssue[]> {
  const audioInputs = await loadPublishPartAudioGateInputs(partRows);
  return mergePublishWorkIssues(
    {
      title: row.title,
      sources,
      tags,
      parts: partRows.map((part) => ({ body: part.body })),
    },
    audioInputs,
  );
}
