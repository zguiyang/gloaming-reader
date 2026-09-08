export function coverUrlFromAssetId(coverAssetId: string | null): string | null {
  if (!coverAssetId) {
    return null;
  }
  return `/api/assets/${encodeURIComponent(coverAssetId)}`;
}
