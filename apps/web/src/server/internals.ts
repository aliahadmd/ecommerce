
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
