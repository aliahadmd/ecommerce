
import { schema, and, eq, inArray, sql  } from "@ecommerce/db"
import type {Tx} from "@ecommerce/db";

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
  const [agg] = await tx
    .select({
      minPrice: sql<number | null>`min(${schema.productVariants.priceCents})`,
      totalStock: sql<number>`coalesce(sum(${schema.productVariants.stock}), 0)::int`,
    })
    .from(schema.productVariants)
    .where(
      and(
        eq(schema.productVariants.productId, productId),
        inArray(schema.productVariants.status, ["active", "draft"]),
      ),
    )
  await tx
    .update(schema.products)
    .set({
      priceCents: agg?.minPrice ?? 0,
      stock: agg?.totalStock ?? 0,
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

const SUB_ORDER_RANK: Record<string, number> = {
  pending: 0,
  confirmed: 1,
  shipped: 2,
  delivered: 3,
}

/**
 * Derive the parent order's status from its sub-orders (plan-2).
 * All cancelled → cancelled; all delivered → delivered; otherwise the
 * earliest active stage.
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
  const list = statuses.map((s) => s.status)
  let derived: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled"
  if (list.every((s) => s === "cancelled")) {
    derived = "cancelled"
  } else {
    const active = list.filter((s) => s !== "cancelled")
    if (active.every((s) => s === "delivered")) derived = "delivered"
    else {
      derived = "pending"
      for (const st of active) {
        if (SUB_ORDER_RANK[st] < SUB_ORDER_RANK[derived]) {
          derived = st
        }
      }
    }
  }
  await tx
    .update(schema.orders)
    .set({ status: derived })
    .where(eq(schema.orders.id, orderId))
}
