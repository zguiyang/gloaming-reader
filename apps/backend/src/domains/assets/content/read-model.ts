import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
} from '@gloaming/db';
import {
  audioKindForRole,
  type ContentAssetTrack,
  type PartAudioView,
  type WorkAudioSummary,
  type WorkAudioView,
} from '@gloaming/shared/content-assets';
import { type TtsVoiceRole } from '@gloaming/shared/tts';

import { loadPart } from '@/domains/assets/content/part-access';
import { type AssetRow, toTrack } from '@/domains/assets/content/track-view';
import { hashPartAudioContent } from '@/domains/works';
import { db } from '@/infra/db';
import { NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

function summarize(tracks: ContentAssetTrack[]): WorkAudioSummary {
  const summary: WorkAudioSummary = {
    total: tracks.length,
    none: 0,
    generating: 0,
    ready: 0,
    stale: 0,
    failed: 0,
  };
  for (const track of tracks) {
    summary[track.status] += 1;
  }
  return summary;
}

export async function getPartAudio(partId: string): Promise<PartAudioView> {
  const part = await loadPart(partId);
  const currentContentHash = hashPartAudioContent(part.body);
  const metaRows = await db.select().from(contentAssetTable).where(eq(contentAssetTable.partId, partId));
  const metaByKind = new Map<string, AssetRow>();
  for (const row of metaRows) {
    if (row.kind === 'audio_us' || row.kind === 'audio_uk') {
      metaByKind.set(row.kind, row);
    }
  }

  return {
    partId: part.id,
    workId: part.workId,
    title: part.title,
    currentContentHash,
    tracks: {
      us: toTrack('us', currentContentHash, metaByKind.get('audio_us') ?? null),
      uk: toTrack('uk', currentContentHash, metaByKind.get('audio_uk') ?? null),
    },
  };
}

export async function getWorkAudio(workId: string, role: TtsVoiceRole): Promise<WorkAudioView> {
  const [work] = await db
    .select({ id: readingWorkTable.id })
    .from(readingWorkTable)
    .where(eq(readingWorkTable.id, workId))
    .limit(1);
  if (!work) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }

  const parts = await db
    .select({
      id: readingPartTable.id,
      title: readingPartTable.title,
      body: readingPartTable.body,
      sortOrder: readingPartTable.sortOrder,
    })
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId))
    .orderBy(asc(readingPartTable.sortOrder));

  const partIds = parts.map((p) => p.id);
  const kind = audioKindForRole(role);
  const assets =
    partIds.length === 0
      ? []
      : await db
          .select()
          .from(contentAssetTable)
          .where(and(inArray(contentAssetTable.partId, partIds), eq(contentAssetTable.kind, kind)));
  const byPart = new Map(assets.map((row) => [row.partId!, row]));

  const rows = parts.map((part) => {
    const currentContentHash = hashPartAudioContent(part.body);
    return {
      partId: part.id,
      sortOrder: part.sortOrder,
      title: part.title,
      currentContentHash,
      track: toTrack(role, currentContentHash, byPart.get(part.id) ?? null),
    };
  });

  return {
    workId,
    role,
    summary: summarize(rows.map((r) => r.track)),
    parts: rows,
  };
}
