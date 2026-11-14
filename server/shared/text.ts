const PREVIEW_MAX = 200;

type TruncatePreviewOptions = {
  /** Trim surrounding whitespace before measuring, as chat previews do. */
  trim?: boolean;
};

/** Shorten text for previews, keeping a single-character ellipsis. */
export function truncatePreview(text: string, max = PREVIEW_MAX, options: TruncatePreviewOptions = {}): string {
  const value = options.trim ? text.trim() : text;
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
