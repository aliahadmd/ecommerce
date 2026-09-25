# Plan 6 — File Storage with SeaweedFS (S3)

**Status:** Done (executed early, before the seed)
**Depends on:** plan-3 (SeaweedFS running), plan-5 (auth guards)
**Estimated effort:** 0.5–1 day

---

## Goal

Product images upload to SeaweedFS via its S3 API and render on the storefront. All access goes through `packages/storage`, configured purely by env (`S3_*` from plan-1 §7) — so pointing at a real S3 in production is a config change.

## `packages/storage`

- Deps: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (kept for a future direct-to-S3 flow), `@ecommerce/config`.
- Client singleton: `S3Client` with `endpoint: env.S3_ENDPOINT`, `region: env.S3_REGION`, `forcePathStyle: true` (required for SeaweedFS and most S3-compatible stores), dev keys from env.
- `ensureBucket()` — idempotent `CreateBucket` if missing (dev convenience, called on app boot / seed). Prod behavior: expect the bucket to exist, log a warning if creation was needed.
- Key layout — ownership is derivable from the key:

  ```
  shops/{shopId}/products/{productId}/{uuid}.{ext}
  ```

- `publicUrl(key)` = `${env.S3_PUBLIC_URL}/${key}` where `S3_PUBLIC_URL=http://localhost:8333/products` in dev.

## Upload decision (phase 1): proxy through the server

Browser → server function → S3. Rationale: zero CORS configuration on SeaweedFS, auth re-checked server-side on every upload, works identically against any S3 later. A presigned-PUT direct-to-S3 flow is a known optimization for a later phase (the presigner dep is already present).

## Server functions (in `apps/web/src/server/uploads.ts`)

| Function | Auth | Behavior |
| --- | --- | --- |
| `uploadProductImage({ productId, file })` | seller owning the product's shop, or admin | Validate (below) → write to S3 under the key layout → insert `product_images` row → return `{ id, url, key }` |
| `deleteProductImage({ imageId })` | same ownership rule | Delete S3 object + row |
| `setPrimaryImage({ productId, imageId })` | same | Reorder `sortOrder` so it's first |

Validation (Zod + manual checks):

- MIME must be `image/jpeg | image/png | image/webp`; extension derived from MIME, not the filename.
- Max size 5 MB; max 8 images per product (enforced on insert).
- Filename inside the key is a fresh UUID — user-supplied names never touch storage (path traversal impossible by construction).
- Per-user Redis rate limit: 30 uploads/hour (via `packages/redis`).

Multipart handling: TanStack Start server function receives `FormData`; file read as stream/buffer per SDK needs.

## UI integration (consumed fully in plan-7's product form)

- `ImageUploader` component: drag/click to add, thumbnails with remove + "make primary", upload progress via TanStack Query mutation, optimistic list update, toast on failure.

## Acceptance criteria

- [ ] Seller uploads a JPG/PNG/WebP through the component; image renders on the product page from `http://localhost:8333/products/shops/…`.
- [ ] File is visible in SeaweedFS filer UI (http://localhost:8888) under the expected key.
- [ ] Uploading a 10 MB file, a `.svg`, or a renamed `.exe→.jpg` is rejected with a clear error.
- [ ] 9th image on one product is rejected.
- [ ] A seller cannot upload into another seller's product (403).
- [ ] Deleting an image removes both the row and the S3 object.
- [ ] Rate limit trips after 31 uploads in an hour (test with a loop).

## Explicitly not in this plan

Image resizing/optimization pipeline (later phase), presigned direct uploads (later phase), category/tag images.

---

## As-built note (2026-09-25)

Storage package as planned: S3 client with forcePathStyle, ensureBucket, ownership-encoded keys, server-proxied uploads, MIME/size/count validation, Redis rate limit. Presigner dep present for a future direct-upload flow.
