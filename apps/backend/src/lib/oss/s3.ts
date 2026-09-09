import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

import type {
  ObjectGetResult,
  ObjectGetStreamResult,
  ObjectListResult,
  ObjectPutInput,
  ObjectRange,
  ObjectStore,
} from '@/lib/oss/types';

export type S3ObjectStoreConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  /** Injected for tests — production builds a real S3Client. */
  client?: Pick<S3Client, 'send'>;
};

async function streamBodyToBuffer(body: unknown): Promise<Buffer> {
  if (body == null) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
    const transform = (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray;
    if (typeof transform === 'function') {
      return Buffer.from(await transform.call(body));
    }
  }
  throw new Error('Unsupported S3 object body type');
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (record.name === 'NotFound' || record.name === 'NoSuchKey') {
    return true;
  }
  return record.$metadata?.httpStatusCode === 404;
}

/** Normalize S3 response bodies (Node Readable / Blob / Buffer) to a Web ReadableStream. */
function toWebStream(body: unknown): ReadableStream<Uint8Array> {
  if (body == null) {
    return new ReadableStream<Uint8Array>();
  }
  if (body instanceof Uint8Array) {
    return new Blob([Buffer.from(body)]).stream() as ReadableStream<Uint8Array>;
  }
  if (typeof body === 'object' && body !== null) {
    const candidate = body as { pipe?: unknown; stream?: () => unknown };
    if (typeof candidate.pipe === 'function') {
      return Readable.toWeb(body as Readable) as ReadableStream<Uint8Array>;
    }
    if (typeof candidate.stream === 'function') {
      return (body as Blob).stream() as ReadableStream<Uint8Array>;
    }
  }
  throw new Error('Unsupported S3 stream body type');
}

/** Low-level adapter for any S3-compatible object storage service. */
export function createS3ObjectStore(config: S3ObjectStoreConfig): ObjectStore {
  const clientConfig: S3ClientConfig = {
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
  const client = config.client ?? new S3Client(clientConfig);
  const bucket = config.bucket;

  return {
    async put(input: ObjectPutInput): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: input.metadata,
        }),
      );
    },

    async get(key: string): Promise<ObjectGetResult | null> {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return {
          body: await streamBodyToBuffer(response.Body),
          contentType: response.ContentType?.trim() || 'application/octet-stream',
        };
      } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
      }
    },

    async getStream(key: string, range?: ObjectRange): Promise<ObjectGetStreamResult | null> {
      try {
        const response = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            Range: range ? `bytes=${range.start}-${range.end ?? ''}` : undefined,
          }),
        );
        return {
          stream: toWebStream(response.Body),
          contentType: response.ContentType?.trim() || 'application/octet-stream',
          contentLength: typeof response.ContentLength === 'number' ? response.ContentLength : null,
          contentRange: response.ContentRange ?? null,
          etag: response.ETag ?? null,
        };
      } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
      }
    },

    async exists(key: string): Promise<boolean> {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (isNotFoundError(error)) return false;
        throw error;
      }
    },

    async delete(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async list(prefix?: string, cursor?: string): Promise<ObjectListResult> {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: cursor,
        }),
      );
      return {
        objects: (response.Contents ?? [])
          .filter((object): object is typeof object & { Key: string } => typeof object.Key === 'string')
          .map((object) => ({
            key: object.Key,
            size: object.Size ?? 0,
            lastModified: object.LastModified ?? null,
            etag: object.ETag ?? null,
          })),
        nextCursor: response.NextContinuationToken ?? null,
        hasMore: response.IsTruncated === true,
      };
    },
  };
}
