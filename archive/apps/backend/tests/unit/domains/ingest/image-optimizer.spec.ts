import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { IMAGE_OPTIMIZER_TRANSFORM_VERSION, optimizeIngestImage } from '@/domains/ingest/parser/image-optimizer';

const MINIMAL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

async function maxLongEdge(bytes: Buffer): Promise<number> {
  const meta = await sharp(bytes).metadata();
  return Math.max(meta.width ?? 0, meta.height ?? 0);
}

describe('optimizeIngestImage', () => {
  it('converts JPEG to smaller WebP when beneficial', async () => {
    const bytes = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 40, g: 120, b: 200 } },
    })
      .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
      .toBuffer();

    const result = await optimizeIngestImage({ bytes, mime: 'image/jpeg' });

    expect(result.transform).toBe('webp');
    expect(result.mime).toBe('image/webp');
    expect(result.originalMime).toBe('image/jpeg');
    expect(result.originalByteLength).toBe(bytes.length);
    expect(result.finalByteLength).toBe(result.bytes.length);
    expect(result.finalByteLength).toBeLessThan(result.originalByteLength);
    expect(result.transformVersion).toBe(IMAGE_OPTIMIZER_TRANSFORM_VERSION);
    await expect(sharp(result.bytes).metadata()).resolves.toMatchObject({ format: 'webp' });
  });

  it('converts PNG to smaller WebP when beneficial', async () => {
    const bytes = await sharp({
      create: { width: 512, height: 512, channels: 3, background: { r: 200, g: 50, b: 50 } },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();

    const result = await optimizeIngestImage({ bytes, mime: 'image/png' });

    expect(result.transform).toBe('webp');
    expect(result.mime).toBe('image/webp');
    expect(result.originalMime).toBe('image/png');
    expect(result.finalByteLength).toBeLessThan(result.originalByteLength);
    expect(result.bytes.length).toBe(result.finalByteLength);
  });

  it('downscales oversized raster images to max long edge without upscaling small images', async () => {
    const oversized = await sharp({
      create: { width: 3200, height: 1200, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    const oversizedResult = await optimizeIngestImage({ bytes: oversized, mime: 'image/jpeg' });
    expect(oversizedResult.transform).toBe('webp');
    expect(await maxLongEdge(oversizedResult.bytes)).toBeLessThanOrEqual(2048);

    const small = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    const smallEdgeBefore = await maxLongEdge(small);
    const smallResult = await optimizeIngestImage({ bytes: small, mime: 'image/jpeg' });
    if (smallResult.transform === 'webp') {
      expect(await maxLongEdge(smallResult.bytes)).toBe(smallEdgeBefore);
    } else {
      expect(smallResult.bytes).toEqual(small);
      expect(await maxLongEdge(smallResult.bytes)).toBe(smallEdgeBefore);
    }
  });

  it('preserves GIF, SVG, and unknown MIME unchanged', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', 'utf8');
    const unknown = Buffer.from([0x00, 0x01, 0x02, 0x03]);

    for (const [bytes, mime] of [
      [MINIMAL_GIF, 'image/gif'],
      [svg, 'image/svg+xml'],
      [unknown, 'application/octet-stream'],
    ] as const) {
      const result = await optimizeIngestImage({ bytes, mime });
      expect(result.transform).toBe('none');
      expect(result.bytes).toEqual(bytes);
      expect(result.mime).toBe(mime);
      expect(result.originalMime).toBe(mime);
      expect(result.originalByteLength).toBe(bytes.length);
      expect(result.finalByteLength).toBe(bytes.length);
    }
  });

  it('falls back to original bytes when WebP is not smaller', async () => {
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .webp({ quality: 20, effort: 0 })
      .toBuffer();

    const result = await optimizeIngestImage({ bytes, mime: 'image/webp' });

    expect(result.transform).toBe('none');
    expect(result.bytes).toEqual(bytes);
    expect(result.mime).toBe('image/webp');
    expect(result.originalByteLength).toBe(result.finalByteLength);
  });

  it('falls back when sharp processing fails', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

    const result = await optimizeIngestImage({ bytes, mime: 'image/png' });

    expect(result.transform).toBe('none');
    expect(result.bytes).toEqual(bytes);
    expect(result.mime).toBe('image/png');
    expect(result.originalByteLength).toBe(bytes.length);
    expect(result.finalByteLength).toBe(bytes.length);
  });
});
