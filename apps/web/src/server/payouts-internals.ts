import { db, schema, and, eq, sql } from "@ecommerce/db"
import { settleOutcome } from "@/lib/order-status"
import { recomputeOrderStatus } from "./internals"
import { readStoreSettings } from "./settings-internals"

/**
 * SERVER-ONLY ledger helpers (plan-5). Never import from client code —
 * these reference the drizzle client directly.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Commission percent from the admin store settings (H2). */
export async function getCommissionPercent(tx?: Tx): Promise<number> {
  return (await readStoreSettings(tx ?? db)).commissionRate
}

/** One immutable `sale` entry per delivered sub-order. Idempotent in-tx. */
export async function ledgerSaleForSubOrder(
  tx: Tx,
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

  const percent = await getCommissionPercent(tx)
  // total_cents is already net of the coupon discount (subtotal + shipping −
  // discount); subtracting discount again under-credited sellers (H1)
  const gross = sub.totalCents
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

/**
 * Derive orders.payment_status from the payments table (plan-3/M11):
 * captured (incl. partially refunded) → paid; still collectable → unpaid;
 * otherwise (failed / fully refunded) → void.
 */
export async function deriveOrderPaymentStatus(
  tx: Tx,
  orderId: string
): Promise<void> {
  const [row] = await tx
    .select({
      paid: sql<number>`count(*) FILTER (WHERE state IN ('succeeded', 'partially_refunded'))::int`,
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

/**
 * Settle a card payment after gateway verification (plan 003). The ONLY
 * place a card payment transitions. Idempotent on `succeeded`; confirms only
 * sub-orders still `pending`; derives (never hardcodes) the parent status; a
 * late payment for a fully cancelled order is recorded as failed instead of
 * resurrecting it.
 */
export async function settleCardPayment(
  tx: Tx,
  paymentId: string,
  outcome: "succeeded" | "failed"
): Promise<"succeeded" | "failed" | null> {
  const [payment] = await tx
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, paymentId))
    .for("update")
    .limit(1)
  if (!payment || payment.method !== "card") return null
  const [{ active }] = await tx
    .select({
      active: sql<number>`count(*) FILTER (WHERE status <> 'cancelled')::int`,
    })
    .from(schema.subOrders)
    .where(eq(schema.subOrders.orderId, payment.orderId))
  const next = settleOutcome({
    current: payment.state,
    outcome,
    activeSubOrders: active ?? 0,
  })
  if (next === "noop") {
    return payment.state === "succeeded" ? "succeeded" : "failed"
  }
  await tx
    .update(schema.payments)
    .set({ state: next })
    .where(eq(schema.payments.id, payment.id))
  if (next === "succeeded") {
    // paid card orders skip the seller-confirm wait
    await tx
      .update(schema.subOrders)
      .set({ status: "confirmed" })
      .where(
        and(
          eq(schema.subOrders.orderId, payment.orderId),
          eq(schema.subOrders.status, "pending")
        )
      )
    await recomputeOrderStatus(tx, payment.orderId)
  }
  await deriveOrderPaymentStatus(tx, payment.orderId)
  return next
}
