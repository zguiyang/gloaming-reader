import sharp from 'sharp';

/** Persisted alongside optimized assets so reprocessing can be versioned. */
export const IMAGE_OPTIMIZER_TRANSFORM_VERSION = '1';

const MAX_LONG_EDGE_PX = 2048;
/** Fixed WebP quality for ingest; tuned for readability vs size on book illustrations. */
const WEBP_QUALITY = 82;

const MIME_JPEG = 'image/jpeg';
const MIME_PNG = 'image/png';
const MIME_WEBP = 'image/webp';

export type ImageOptimizeInput = {
  bytes: Buffer;
  mime: string;
};

export type ImageOptimizeTransform = 'none' | 'webp';

export type ImageOptimizeResult = {
  bytes: Buffer;
  mime: string;
  originalMime: string;
  originalByteLength: number;
  finalByteLength: number;
  transform: ImageOptimizeTransform;
  transformVersion: string;
};

function normalizeMime(mime: string): string {
  const lower = mime.trim().toLowerCase();
  if (lower === 'image/jpg') {
    return MIME_JPEG;
  }
  return lower;
}

function isStaticRasterMime(mime: string): boolean {
  return mime === MIME_JPEG || mime === MIME_PNG || mime === MIME_WEBP;
}

function passthrough(bytes: Buffer, mime: string): ImageOptimizeResult {
  const normalized = normalizeMime(mime);
  return {
    bytes,
    mime: normalized,
    originalMime: normalized,
    originalByteLength: bytes.length,
    finalByteLength: bytes.length,
    transform: 'none',
    transformVersion: IMAGE_OPTIMIZER_TRANSFORM_VERSION,
  };
}

async function candidateIsAcceptable(candidate: Buffer, originalByteLength: number): Promise<boolean> {
  if (candidate.length >= originalByteLength) {
    return false;
  }

  try {
    const inspected = sharp(candidate, { failOn: 'error' });
    const meta = await inspected.metadata();
    if (meta.format !== 'webp') {
      return false;
    }
    await inspected.clone().raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}

async function encodeWebp(bytes: Buffer, needsResize: boolean): Promise<Buffer> {
  let pipeline = sharp(bytes, { failOn: 'error' });
  if (needsResize) {
    pipeline = pipeline.resize({
      fit: 'inside',
      withoutEnlargement: true,
      width: MAX_LONG_EDGE_PX,
      height: MAX_LONG_EDGE_PX,
    });
  }
  return pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer();
}

function webpSuccess(bytes: Buffer, originalMime: string, originalByteLength: number): ImageOptimizeResult {
  return {
    bytes,
    mime: MIME_WEBP,
    originalMime,
    originalByteLength,
    finalByteLength: bytes.length,
    transform: 'webp',
    transformVersion: IMAGE_OPTIMIZER_TRANSFORM_VERSION,
  };
}

/**
 * Optimizes static raster images for ingest storage. GIF, SVG, and unknown MIME types
 * are returned unchanged. JPEG/PNG prefer WebP when the result is smaller and valid.
 * WebP is reprocessed only when resizing is required or a smaller output is proven safe.
 */
export async function optimizeIngestImage(input: ImageOptimizeInput): Promise<ImageOptimizeResult> {
  const originalByteLength = input.bytes.length;
  const originalMime = normalizeMime(input.mime);

  if (!isStaticRasterMime(originalMime)) {
    return passthrough(input.bytes, input.mime);
  }

  try {
    const meta = await sharp(input.bytes, { failOn: 'error' }).metadata();
    if (!meta.width || !meta.height) {
      return passthrough(input.bytes, input.mime);
    }

    const longEdge = Math.max(meta.width, meta.height);
    const needsResize = longEdge > MAX_LONG_EDGE_PX;
    const isJpegOrPng = originalMime === MIME_JPEG || originalMime === MIME_PNG;
    const isWebp = originalMime === MIME_WEBP;

    if (isWebp && !needsResize) {
      const candidate = await encodeWebp(input.bytes, false);
      if (await candidateIsAcceptable(candidate, originalByteLength)) {
        return webpSuccess(candidate, originalMime, originalByteLength);
      }
      return passthrough(input.bytes, input.mime);
    }

    if (isJpegOrPng || (isWebp && needsResize)) {
      const candidate = await encodeWebp(input.bytes, needsResize);
      if (await candidateIsAcceptable(candidate, originalByteLength)) {
        return webpSuccess(candidate, originalMime, originalByteLength);
      }
    }

    return passthrough(input.bytes, input.mime);
  } catch {
    return passthrough(input.bytes, input.mime);
  }
}
