import { createServerFn } from "@tanstack/react-start"
import { db, schema, eq } from "@ecommerce/db"
import { rateLimit } from "@ecommerce/redis"
import {
  buildImageKey,
  deleteObject,
  isAllowedImageMime,
  MAX_IMAGE_BYTES,
  publicUrl,
  uploadImage,
} from "@ecommerce/storage"
import { AppError, guard, requireRole } from "./session"

const MAX_IMAGES_PER_PRODUCT = 8

/** Load a product with its shop owner — the ownership check used everywhere. */
async function productWithOwner(productId: string) {
  const [row] = await db
    .select({
      productId: schema.products.id,
      shopId: schema.shops.id,
      ownerId: schema.shops.ownerId,
    })
    .from(schema.products)
    .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
    .where(eq(schema.products.id, productId))
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Product not found")
  return row
}

function assertCanManage(
  user: { id: string; role: string },
  ownerId: string
): void {
  if (user.role !== "super_admin" && user.id !== ownerId) {
    throw new AppError("FORBIDDEN", "You can only manage your own products")
  }
}

export const uploadProductImage = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as FormData)
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const allowed = await rateLimit("upload", user.id, 30, 3600)
      if (!allowed) {
        throw new AppError("RATE_LIMITED", "Too many uploads — try again later")
      }

      const productId = String(data.get("productId") ?? "")
      const file = data.get("file")
      if (!(file instanceof File)) {
        throw new AppError("INVALID", "No file provided")
      }
      if (!isAllowedImageMime(file.type)) {
        throw new AppError(
          "INVALID",
          "Only JPEG, PNG or WebP images are allowed"
        )
      }
      if (file.size > MAX_IMAGE_BYTES) {
        throw new AppError("INVALID", "Image must be 5MB or smaller")
      }

      const target = await productWithOwner(productId)
      assertCanManage(user, target.ownerId)

      const count = await db.$count(
        schema.productImages,
        eq(schema.productImages.productId, productId)
      )
      if (count >= MAX_IMAGES_PER_PRODUCT) {
        throw new AppError(
          "INVALID",
          `Max ${MAX_IMAGES_PER_PRODUCT} images per product`
        )
      }

      const key = buildImageKey(target.shopId, productId, file.type)
      await uploadImage(key, new Uint8Array(await file.arrayBuffer()), file.type)
      const [image] = await db
        .insert(schema.productImages)
        .values({
          productId,
          key,
          url: publicUrl(key),
          alt: file.name.slice(0, 120),
          sortOrder: count,
        })
        .returning()
      return { id: image.id, url: image.url }
    })
  )

export const deleteProductImage = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const { imageId } = input as { imageId: string }
    if (typeof imageId !== "string" || imageId.length < 10) {
      throw new AppError("INVALID", "imageId required")
    }
    return { imageId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const [image] = await db
        .select({
          key: schema.productImages.key,
          ownerId: schema.shops.ownerId,
        })
        .from(schema.productImages)
        .innerJoin(
          schema.products,
          eq(schema.productImages.productId, schema.products.id)
        )
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(eq(schema.productImages.id, data.imageId))
        .limit(1)
      if (!image) throw new AppError("NOT_FOUND", "Image not found")
      assertCanManage(user, image.ownerId)
      await db
        .delete(schema.productImages)
        .where(eq(schema.productImages.id, data.imageId))
      await deleteObject(image.key).catch(() => undefined)
      return { deleted: true }
    })
  )

export const setPrimaryImage = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const { productId, imageId } = input as {
      productId: string
      imageId: string
    }
    if (!productId || !imageId) {
      throw new AppError("INVALID", "productId and imageId required")
    }
    return { productId, imageId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const target = await productWithOwner(data.productId)
      assertCanManage(user, target.ownerId)

      const images = await db
        .select({ id: schema.productImages.id })
        .from(schema.productImages)
        .where(eq(schema.productImages.productId, data.productId))
      const ordered = [
        data.imageId,
        ...images.map((i) => i.id).filter((id) => id !== data.imageId),
      ]
      for (const [i, id] of ordered.entries()) {
        await db
          .update(schema.productImages)
          .set({ sortOrder: i })
          .where(eq(schema.productImages.id, id))
      }
      return { ok: true }
    })
  )
