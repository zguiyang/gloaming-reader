/** Private cover tint helpers for WorkCover. Not part of the public surface. */

export const VOLUME_COVER_TINTS = ['bg-paper', 'bg-muted', 'bg-secondary', 'bg-accent/50'] as const;

export type VolumeCoverTint = (typeof VOLUME_COVER_TINTS)[number];

export function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function coverTintForVolume(tags: string[], title: string): VolumeCoverTint {
  const seed = tags[0]?.trim() || title.trim() || 'volume';
  return VOLUME_COVER_TINTS[hashSeed(seed) % VOLUME_COVER_TINTS.length]!;
}
