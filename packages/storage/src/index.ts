import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getEnv } from "@ecommerce/config";

let client: S3Client | null = null;

function getS3(): S3Client {
  if (!client) {
    const env = getEnv();
    client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true, // required for SeaweedFS and most S3-compatible stores
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }
  return client;
}

/** Public URL for an object key. Anonymous Read is enabled on the dev bucket. */
export function publicUrl(key: string): string {
  return `${getEnv().S3_PUBLIC_URL}/${key}`;
}

/** Idempotent: create the bucket if it doesn't exist (dev convenience).
 *  Other HeadBucket failures (auth, network) are rethrown — masking them
 *  turned real outages into confusing CreateBucket errors. */
export async function ensureBucket(): Promise<void> {
  const s3 = getS3();
  const Bucket = getEnv().S3_BUCKET;
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) {
      await s3.send(new CreateBucketCommand({ Bucket }));
      return;
    }
    throw err;
  }
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isAllowedImageMime(mime: string): boolean {
  return mime in MIME_EXT;
}

/**
 * Key layout encodes ownership: sellers may only touch keys under their own
 * shop/product prefix. User-supplied filenames never reach storage.
 */
export function buildImageKey(shopId: string, productId: string, mime: string): string {
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error(`Unsupported image MIME: ${mime}`);
  return `shops/${shopId}/products/${productId}/${randomUUID()}.${ext}`;
}

export async function uploadImage(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: getEnv().S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await getS3().send(new DeleteObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: key }));
}
