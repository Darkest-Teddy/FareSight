import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command,
  PutBucketCorsCommand, PutBucketPolicyCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { CaptureConfig } from '../config.ts';

export const PRESIGN_SECONDS = 15 * 60;

/** S3-compatible object storage (Vultr Object Storage in production, MinIO locally). */
export function createObjectStorage(config: Pick<CaptureConfig, 'endpoint' | 'region' | 'accessKey' | 'secretKey'>) {
  const connect = (region: string) => new S3Client({
    endpoint: config.endpoint, region, forcePathStyle: true,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    // The SDK's default CRC32 trailers are an AWS extension that other S3 implementations can reject.
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const client = connect(config.region);

  return {
    /** A short-lived URL the browser PUTs one file to. The content type is signed, so it cannot be swapped. */
    presignPut(bucket: string, key: string, contentType: string) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
        expiresIn: PRESIGN_SECONDS, signableHeaders: new Set(['content-type']),
      });
    },

    async list(bucket: string, prefix: string) {
      const objects: { key: string; size: number }[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const { Key, Size } of page.Contents ?? []) if (Key) objects.push({ key: Key, size: Size ?? 0 });
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return objects;
    },

    async get(bucket: string, key: string) {
      const { Body } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!Body) throw new Error(`Object ${key} has no body`);
      return Buffer.from(await Body.transformToByteArray());
    },

    async put(bucket: string, key: string, body: Buffer, contentType: string, options: { public?: boolean; cacheControl?: string } = {}) {
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: body, ContentType: contentType,
        // Public objects are keyed by job unless the caller says otherwise, so a URL's content never changes.
        ...(options.public ? { ACL: 'public-read' as const, CacheControl: options.cacheControl ?? 'public, max-age=31536000, immutable' } : {}),
      }));
    },

    async remove(bucket: string, key: string) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    /** Deletes every object under a prefix and returns how many there were. */
    async deletePrefix(bucket: string, prefix: string) {
      const objects = await this.list(bucket, prefix);
      // One request per object: the batch DeleteObjects call needs a checksum header that not every S3 clone accepts.
      for (const { key } of objects) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return objects.length;
    },

    /** Creates the bucket if needed and sets its CORS rules. Public buckets also allow anonymous reads. */
    async setupBucket(bucket: string, options: { public: boolean; origins: string[] }) {
      const notes: string[] = [];
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        // For any region but us-east-1 the SDK adds a LocationConstraint naming it, which Vultr rejects
        // (InvalidLocationConstraint). The endpoint already decides where the bucket lives.
        const creator = connect('us-east-1');
        try {
          await creator.send(new CreateBucketCommand({ Bucket: bucket }));
        } finally {
          creator.destroy();
        }
        notes.push('created');
      }
      const optional = async (label: string, action: () => Promise<unknown>) => {
        try {
          await action();
          notes.push(label);
        } catch (error) {
          notes.push(`${label} not applied (${error instanceof Error ? error.name : 'error'})`);
        }
      };
      await optional('CORS', () => client.send(new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: [{
          AllowedOrigins: options.origins, AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600,
          AllowedMethods: options.public ? ['GET', 'HEAD'] : ['PUT'],
        }] },
      })));
      if (options.public) {
        await optional('public-read policy', () => client.send(new PutBucketPolicyCommand({
          Bucket: bucket,
          Policy: JSON.stringify({ Version: '2012-10-17', Statement: [{
            Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${bucket}/*`],
          }] }),
        })));
      }
      return notes;
    },

    close() { client.destroy(); },
  };
}

export type ObjectStorage = ReturnType<typeof createObjectStorage>;
