import { randomUUID } from "node:crypto";
import {
  CopyObjectCommand,
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
 * Detect the real image type from the file's magic bytes. The browser's
 * declared Content-Type is attacker-controlled, so uploads are typed by
 * content (README #3). Returns null for anything but JPEG/PNG/WebP.
 */
export function sniffImageMime(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
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

/**
 * Copy an existing product image to a new key under another product
 * (product duplication). Each product owns its objects, so deleting an image
 * on the copy never breaks the original.
 */
export async function copyProductImage(
  srcKey: string,
  shopId: string,
  productId: string,
): Promise<{ key: string; url: string }> {
  const ext = srcKey.split(".").pop() ?? "jpg";
  const key = `shops/${shopId}/products/${productId}/${randomUUID()}.${ext}`;
  const Bucket = getEnv().S3_BUCKET;
  await getS3().send(
    new CopyObjectCommand({
      Bucket,
      Key: key,
      CopySource: `${Bucket}/${encodeURI(srcKey)}`,
    }),
  );
  return { key, url: publicUrl(key) };
}
