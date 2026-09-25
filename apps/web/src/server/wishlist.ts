import { createServerFn } from "@tanstack/react-start"

import { db, schema, and, desc, eq, inArray, sql } from "@ecommerce/db"
import { AppError, guard, requireUser } from "./session"

const wishlistCardColumns = {
  id: schema.products.id,
  title: schema.products.title,
  slug: schema.products.slug,
  priceCents: schema.products.priceCents,
  currency: schema.products.currency,
  stock: schema.products.stock,
  shopName: schema.shops.name,
  shopSlug: schema.shops.slug,
  brand: schema.products.brand,
  condition: schema.products.condition,
}

export const listWishlist = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireUser()
    return db
      .select({
        ...wishlistCardColumns,
        savedAt: schema.wishlistItems.createdAt,
        imageUrl: sql<string | null>`(
          select pi.url from product_images pi
          where pi.product_id = ${schema.products.id}
          order by pi.sort_order asc limit 1
        )`,
      })
      .from(schema.wishlistItems)
      .innerJoin(schema.products, eq(schema.wishlistItems.productId, schema.products.id))
      .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
      .where(
        and(
          eq(schema.wishlistItems.userId, user.id),
          eq(schema.products.status, "active"),
          eq(schema.shops.status, "active"),
        ),
      )
      .orderBy(desc(schema.wishlistItems.createdAt))
  }),
)


export const toggleWishlist = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const productId = String((input as { productId?: unknown })?.productId ?? "")
    if (!productId) throw new AppError("INVALID", "productId required")
    return { productId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const [product] = await db
        .select({ id: schema.products.id })
        .from(schema.products)
        .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
        .where(
          and(
            eq(schema.products.id, data.productId),
            eq(schema.products.status, "active"),
            eq(schema.shops.status, "active"),
          ),
        )
        .limit(1)
      if (!product) throw new AppError("NOT_FOUND", "Product not found")

      const [existing] = await db
        .select({ id: schema.wishlistItems.id })
        .from(schema.wishlistItems)
        .where(
          and(
            eq(schema.wishlistItems.userId, user.id),
            eq(schema.wishlistItems.productId, data.productId),
          ),
        )
        .limit(1)
      if (existing) {
        await db.delete(schema.wishlistItems).where(eq(schema.wishlistItems.id, existing.id))
        return { saved: false }
      }
      await db
        .insert(schema.wishlistItems)
        .values({ userId: user.id, productId: data.productId })
        .onConflictDoNothing()
      return { saved: true }
    }),
  )

/** Batched saved-status lookup for product grids. */
export const wishlistStatus = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = input as { productIds?: unknown }
    const productIds = Array.isArray(raw.productIds) ? raw.productIds.map(String) : []
    if (productIds.length === 0 || productIds.length > 60) {
      throw new AppError("INVALID", "productIds required (≤60)")
    }
    return { productIds }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const rows = await db
        .select({ productId: schema.wishlistItems.productId })
        .from(schema.wishlistItems)
        .where(
          and(
            eq(schema.wishlistItems.userId, user.id),
            inArray(schema.wishlistItems.productId, data.productIds),
          ),
        )
      return { savedIds: rows.map((r) => r.productId) }
    }),
  )

