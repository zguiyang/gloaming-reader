import { type contentAsset as contentAssetTable, type ContentAssetMeta } from '@gloaming/db';
import { type ContentAssetTrack, deriveAudioTrackStatus } from '@gloaming/shared/content-assets';
import { filterPersistedWordTimings, type TtsVoiceRole, type TtsWordTiming } from '@gloaming/shared/tts';

export type AssetRow = typeof contentAssetTable.$inferSelect;

export function assetUrl(assetId: string): string {
  return `/api/assets/${assetId}`;
}

export function emptyTrack(role: TtsVoiceRole): ContentAssetTrack {
  return {
    role,
    status: 'none',
    voice: null,
    contentHash: null,
    contentStale: false,
    mimeType: null,
    lastError: null,
    generatedAt: null,
    updatedAt: null,
    audioAvailable: false,
    assetId: null,
    audioUrl: null,
    durationMs: null,
  };
}

/** Azure / legacy meta may store fractional ms; client Zod schemas require ints. */
export function intMs(n: number): number {
  return Math.round(n);
}

function timelineForApi(timeline: NonNullable<ContentAssetMeta['timeline']>): ContentAssetTrack['timeline'] {
  return timeline.map((seg) => ({
    ...seg,
    startMs: intMs(seg.startMs),
    durationMs: intMs(seg.durationMs),
    wordTimings: filterPersistedWordTimings(seg.wordTimings ?? []),
  }));
}

/** Flatten chapter timeline word timings for learner APIs (drops invalid historical rows). */
export function wordTimingsFromTimeline(
  timeline: NonNullable<ContentAssetMeta['timeline']> | undefined,
): TtsWordTiming[] {
  return (timeline ?? []).flatMap((seg) => filterPersistedWordTimings(seg.wordTimings ?? []));
}

export function toTrack(role: TtsVoiceRole, currentContentHash: string, asset: AssetRow | null): ContentAssetTrack {
  if (!asset) {
    return emptyTrack(role);
  }

  const meta = asset.meta ?? {};
  const contentStale = asset.contentHash !== currentContentHash;
  const status = deriveAudioTrackStatus(asset, currentContentHash);
  const playable = status === 'ready';
  return {
    role,
    status,
    voice: meta.voice ?? null,
    contentHash: asset.contentHash,
    contentStale,
    mimeType: asset.mimeType,
    lastError: meta.lastError ?? null,
    generatedAt: meta.generatedAt ?? null,
    updatedAt: asset.updatedAt.toISOString(),
    audioAvailable: playable,
    assetId: playable ? asset.id : null,
    audioUrl: playable ? assetUrl(asset.id) : null,
    durationMs: meta.durationMs != null ? intMs(meta.durationMs) : null,
    timeline: playable && meta.timeline ? timelineForApi(meta.timeline) : undefined,
  };
}
