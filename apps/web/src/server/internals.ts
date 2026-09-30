
import { db, schema, and, eq, inArray, sql } from "@ecommerce/db"
import { enqueueNotification } from "@ecommerce/jobs"
import type { Tx } from "@ecommerce/db"
import { deriveOrderStatus } from "@/lib/order-status"

/**
 * Aggregate-maintenance helpers. SERVER-ONLY: these reference the drizzle
 * client and must never appear in a client module graph. They are plain
 * (non-createServerFn) functions used exclusively inside server-function
 * handlers, which TanStack Start strips from client bundles.
 */

export async function recomputeProductAggregates(
  tx: Tx,
  productId: string,
): Promise<void> {
  // Only ACTIVE variants are sellable (M6): drafts must not lower the "from"
  // price or inflate stock. Drafts still supply a display price when nothing
  // is active yet, so a product never shows $0.
  const [agg] = await tx
    .select({
      activeMin: sql<number | null>`min(${schema.productVariants.priceCents}) FILTER (WHERE ${schema.productVariants.status} = 'active')`,
      anyMin: sql<number | null>`min(${schema.productVariants.priceCents})`,
      activeStock: sql<number>`coalesce(sum(${schema.productVariants.stock}) FILTER (WHERE ${schema.productVariants.status} = 'active'), 0)::int`,
      variants: sql<number>`count(*)::int`,
    })
    .from(schema.productVariants)
    .where(
      and(
        eq(schema.productVariants.productId, productId),
        inArray(schema.productVariants.status, ["active", "draft"]),
      ),
    )
  if (!agg || agg.variants === 0) return // variant-less product: own columns rule
  await tx
    .update(schema.products)
    .set({
      priceCents: agg.activeMin ?? agg.anyMin ?? 0,
      stock: agg.activeStock,
    })
    .where(eq(schema.products.id, productId))
}

export async function recomputeProductRating(
  tx: Tx,
  productId: string,
): Promise<void> {
  const [agg] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      avg: sql<number | null>`avg(${schema.reviews.rating})`,
    })
    .from(schema.reviews)
    .where(
      and(
        eq(schema.reviews.productId, productId),
        eq(schema.reviews.status, "approved"),
      ),
    )
  await tx
    .update(schema.products)
    .set({
      ratingCount: agg?.count ?? 0,
      ratingAvgX100: agg?.avg ? Math.round(Number(agg.avg) * 100) : 0,
    })
    .where(eq(schema.products.id, productId))
}

/**
 * Derive the parent order's status from its sub-orders (plan-2). The rule is
 * the pure, unit-tested deriveOrderStatus (H3).
 */
export async function recomputeOrderStatus(
  tx: Tx,
  orderId: string,
): Promise<void> {
  const statuses = await tx
    .select({ status: schema.subOrders.status })
    .from(schema.subOrders)
    .where(eq(schema.subOrders.orderId, orderId))
  if (statuses.length === 0) return
  await tx
    .update(schema.orders)
    .set({ status: deriveOrderStatus(statuses.map((s) => s.status)) })
    .where(eq(schema.orders.id, orderId))
}

/**
 * Notify every user who wishlisted a product that it's back in stock
 * (plan-6). Enqueues in-app notifications + a back_in_stock email.
 */
export async function notifyBackInStock(productId: string): Promise<void> {
  const [prod] = await db
    .select({ title: schema.products.title, stock: schema.products.stock })
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .limit(1)
  if (!prod || prod.stock <= 0) return
  const productTitle = prod.title
  const watchers = await db
    .select({ userId: schema.wishlistItems.userId })
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.productId, productId))
  for (const w of watchers) {
    await enqueueNotification({
      userId: w.userId,
      kind: "back_in_stock",
      title: `${productTitle} is back in stock`,
      body: null,
      link: `/products/${productId}`,
      dedupeKey: `back_in_stock:${productId}:${w.userId}`,
    })
  }
}
