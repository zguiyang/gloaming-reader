const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

export function decodePath(entry: string): string {
  try {
    return decodeURIComponent(entry);
  } catch {
    return entry;
  }
}

export function normalizeHref(href: string): string {
  let result = decodePath(href.trim());
  while (result.startsWith('../')) result = result.slice(3);
  while (result.startsWith('./')) result = result.slice(2);
  result = result.replace(/^\/+/, '');
  return result.split('#')[0]!.trim();
}

/** Resolve a manifest href relative to the OPF directory. */
export function resolveHref(opfDir: string, href: string): string {
  const normalized = normalizeHref(href);
  if (!opfDir || normalized.startsWith(opfDir + '/') || !normalized) return normalized;
  return normalizeHref(`${opfDir}/${normalized}`);
}

/**
 * Resolve a path relative to a zip directory (e.g. chapter folder), honoring
 * `../` segments. Unlike {@link normalizeHref}, does not strip leading `../`
 * before joining — needed for images referenced from nested spine files.
 */
export function resolveAgainstBase(baseDir: string, href: string): string {
  const raw = decodePath(href.trim()).split('#')[0]!.trim();
  if (!raw) return '';
  const joined = [...(baseDir ? baseDir.split('/') : []), ...raw.split('/')];
  const stack: string[] = [];
  for (const part of joined) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

export function parentDir(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

function findEntry(entries: Map<string, Buffer>, name: string): Buffer | undefined {
  const direct = entries.get(name);
  if (direct) return direct;
  const key = normalizeHref(name);
  return entries.get(key);
}

export function findEntryCaseInsensitive(entries: Map<string, Buffer>, name: string): Buffer | undefined {
  const direct = findEntry(entries, name);
  if (direct) return direct;
  const lower = normalizeHref(name).toLowerCase();
  for (const [key] of entries) {
    if (key.toLowerCase() === lower) return entries.get(key);
  }
  return undefined;
}

export function normalizeLanguage(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return 'en';
  const match = /^([a-z]{2,3})(?:[-_])/.exec(value);
  return match ? match[1]! : value.slice(0, 2);
}

export function mimeForHref(href: string): string {
  const ext = href.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext ? (IMAGE_MIME_BY_EXT[`.${ext}`] ?? 'application/octet-stream') : 'application/octet-stream';
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export {
  parentDir as epubParentDir,
  findEntryCaseInsensitive as findEpubEntry,
  normalizeHref as normalizeEpubHref,
  resolveAgainstBase as resolveEpubAgainstBase,
  resolveHref as resolveEpubHref,
};
