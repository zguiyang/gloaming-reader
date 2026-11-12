import { z } from 'zod';

/**
 * JSON `content_asset.meta` contract for non-audio kinds (image / cover /
 * origin_file). Unknown legacy keys pass through so historical rows do not
 * fail whole-asset parsing.
 */
export const contentAssetMetaSchema = z
  .object({
    /**
     * Formal persisted object-storage keys only (e.g. optimized images).
     * Do not list ephemeral or never-persisted keys.
     */
    objectKeys: z.array(z.string()).optional(),
    /** Origin file uploads (kind = origin_file). */
    originalFileName: z.string().optional(),
    size: z.number().nonnegative().optional(),
    /** Original path inside the source EPUB (image / cover assets). */
    originalPath: z.string().optional(),
    /** True when the upload reused an already-stored object (dedupe / instant upload). */
    reused: z.boolean().optional(),
  })
  .passthrough();

export type ContentAssetMeta = z.infer<typeof contentAssetMetaSchema>;
