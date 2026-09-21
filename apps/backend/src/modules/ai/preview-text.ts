const PREVIEW_MAX = 200;

export function truncatePreview(text: string, max = PREVIEW_MAX): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}
