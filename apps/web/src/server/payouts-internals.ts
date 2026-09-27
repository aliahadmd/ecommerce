import { db, schema, and, eq, sql } from "@ecommerce/db"

/**
 * SERVER-ONLY ledger helpers (plan-5). Never import from client code —
 * these reference the drizzle client directly.
 */

export async function getCommissionPercent(): Promise<number> {
  const [row] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "commerce.commission_rate"))
    .limit(1)
  const v = row?.value
  return typeof v === "number" && v >= 0 && v <= 50 ? v : 10
}

/** One immutable `sale` entry per delivered sub-order. Idempotent in-tx. */
export async function ledgerSaleForSubOrder(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  subOrderId: string
): Promise<void> {
  const [existing] = await tx
    .select({ id: schema.sellerLedger.id })
    .from(schema.sellerLedger)
    .where(
      and(
        eq(schema.sellerLedger.subOrderId, subOrderId),
        eq(schema.sellerLedger.kind, "sale")
      )
    )
    .limit(1)
  if (existing) return

  const [sub] = await tx
    .select()
    .from(schema.subOrders)
    .where(eq(schema.subOrders.id, subOrderId))
    .limit(1)
  if (!sub) return

  const percent = await getCommissionPercent()
  const gross = sub.totalCents - sub.discountCents
  const commission = Math.round((gross * percent) / 100)
  await tx.insert(schema.sellerLedger).values({
    shopId: sub.shopId,
    subOrderId: sub.id,
    orderId: sub.orderId,
    kind: "sale",
    grossCents: gross,
    commissionCents: commission,
    netCents: gross - commission,
    memo: null,
  })
}

/** Balancing refund entry. */
export async function ledgerRefundForSubOrder(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  subOrderId: string,
  refundCents: number
): Promise<void> {
  const percent = await getCommissionPercent()
  const commission = Math.round((refundCents * percent) / 100)
  const [sub] = await tx
    .select({ shopId: schema.subOrders.shopId, orderId: schema.subOrders.orderId })
    .from(schema.subOrders)
    .where(eq(schema.subOrders.id, subOrderId))
    .limit(1)
  if (!sub) return
  await tx.insert(schema.sellerLedger).values({
    shopId: sub.shopId,
    subOrderId,
    orderId: sub.orderId,
    kind: "refund",
    grossCents: refundCents,
    commissionCents: commission,
    netCents: -(refundCents - commission),
    memo: "refund",
  })
}

/**
 * Derive orders.payment_status from the payments table (plan-3/M11):
 * any succeeded payment → paid; all failed/void → unpaid.
 */
export async function deriveOrderPaymentStatus(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orderId: string
): Promise<void> {
  const [row] = await tx
    .select({
      paid: sql<number>`count(*) FILTER (WHERE state = 'succeeded')::int`,
      pending: sql<number>`count(*) FILTER (WHERE state IN ('requires_payment', 'processing', 'pending_on_delivery'))::int`,
    })
    .from(schema.payments)
    .where(eq(schema.payments.orderId, orderId))
  const state = (row?.paid ?? 0) > 0 ? "paid" : (row?.pending ?? 0) > 0 ? "unpaid" : "void"
  await tx
    .update(schema.orders)
    .set({ paymentStatus: state })
    .where(eq(schema.orders.id, orderId))
}
