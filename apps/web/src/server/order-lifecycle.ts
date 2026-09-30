import { db, schema, and, eq, inArray, lt, sql } from "@ecommerce/db"
import type { Tx } from "@ecommerce/db"
import { getEnv } from "@ecommerce/config"
import * as paymentsPkg from "@ecommerce/payments"
import {
  notifyBackInStock,
  recomputeOrderStatus,
  recomputeProductAggregates,
} from "./internals"
import { deriveOrderPaymentStatus } from "./payouts-internals"
import { AppError } from "./session"

/**
 * SERVER-ONLY order lifecycle: the single sub-order cancellation routine
 * used by buyer/seller/admin cancels and by the unpaid-card expiry sweep.
 * Never import from route files (plain exports reference the db).
 */

export interface CancelEffects {
  /** products whose stock came back — notify wishlist watchers post-commit */
  restoredProductIds: string[]
  /** card money to hand back through the provider post-commit */
  refund: { providerRef: string; amountCents: number } | null
}

/**
 * Cancel one sub-order inside the caller's transaction.
 * - guarded: only rows still in `fromStatuses` move (L12 — a concurrent
 *   "ship" can no longer be overwritten by a stale cancel)
 * - restores stock, recomputes aggregates + parent status
 * - voids unsettled payments once every sub-order is cancelled (plan 003)
 * - refunds a captured card payment by this sub-order's total (M9)
 */
export async function cancelSubOrderTx(
  tx: Tx,
  subOrderId: string,
  reason: string,
  fromStatuses: ("pending" | "confirmed")[] = ["pending", "confirmed"],
): Promise<CancelEffects> {
  const [sub] = await tx
    .update(schema.subOrders)
    .set({ status: "cancelled", cancelReason: reason })
    .where(
      and(
        eq(schema.subOrders.id, subOrderId),
        inArray(schema.subOrders.status, fromStatuses),
      ),
    )
    .returning({
      orderId: schema.subOrders.orderId,
      totalCents: schema.subOrders.totalCents,
    })
  if (!sub) {
    throw new AppError(
      "CONFLICT",
      "This sub-order changed status in the meantime — refresh and try again",
    )
  }

  const items = await tx
    .select({
      productId: schema.orderItems.productId,
      variantId: schema.orderItems.variantId,
      quantity: schema.orderItems.quantity,
    })
    .from(schema.orderItems)
    .where(eq(schema.orderItems.subOrderId, subOrderId))
  const restored = new Set<string>()
  const variantProducts = new Set<string>()
  for (const item of items) {
    if (item.variantId) {
      await tx
        .update(schema.productVariants)
        .set({ stock: sql`${schema.productVariants.stock} + ${item.quantity}` })
        .where(
          and(
            eq(schema.productVariants.id, item.variantId),
            eq(schema.productVariants.productId, item.productId),
          ),
        )
      variantProducts.add(item.productId)
    } else {
      await tx
        .update(schema.products)
        .set({ stock: sql`${schema.products.stock} + ${item.quantity}` })
        .where(eq(schema.products.id, item.productId))
    }
    restored.add(item.productId)
  }
  for (const pid of variantProducts) {
    await recomputeProductAggregates(tx, pid)
  }
  await recomputeOrderStatus(tx, sub.orderId)

  const [payment] = await tx
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.orderId, sub.orderId))
    .for("update")
    .limit(1)

  let refund: CancelEffects["refund"] = null
  if (
    payment &&
    payment.method === "card" &&
    (payment.state === "succeeded" || payment.state === "partially_refunded")
  ) {
    const refundCents = Math.min(
      payment.amountCents,
      payment.refundCents + sub.totalCents,
    )
    await tx
      .update(schema.payments)
      .set({
        refundCents,
        state: refundCents >= payment.amountCents ? "refunded" : "partially_refunded",
      })
      .where(eq(schema.payments.id, payment.id))
    if (payment.providerRef && refundCents > payment.refundCents) {
      refund = {
        providerRef: payment.providerRef,
        amountCents: refundCents - payment.refundCents,
      }
    }
  }

  const [{ remaining }] = await tx
    .select({
      remaining: sql<number>`count(*) FILTER (WHERE status <> 'cancelled')::int`,
    })
    .from(schema.subOrders)
    .where(eq(schema.subOrders.orderId, sub.orderId))
  if ((remaining ?? 0) === 0) {
    // nothing left to deliver: kill every payment that never settled — COD
    // awaiting cash and card intents alike (plan 003: the gateway page for a
    // cancelled order is dead)
    await tx
      .update(schema.payments)
      .set({ state: "failed" })
      .where(
        and(
          eq(schema.payments.orderId, sub.orderId),
          inArray(schema.payments.state, [
            "pending_on_delivery",
            "requires_payment",
            "processing",
          ]),
        ),
      )
  }
  await deriveOrderPaymentStatus(tx, sub.orderId)

  return { restoredProductIds: [...restored], refund }
}

/** Post-commit side effects of a cancellation (never inside the tx). */
export async function runCancelEffects(effects: CancelEffects): Promise<void> {
  for (const pid of effects.restoredProductIds) {
    await notifyBackInStock(pid).catch((err) =>
      console.error("[orders] back-in-stock notify failed:", err),
    )
  }
  if (effects.refund) {
    const provider = paymentsPkg.getProvider()
    await provider
      .refund(effects.refund)
      .catch((err) =>
        console.error("[payments] provider refund failed — reconcile manually:", err),
      )
  }
}

/**
 * H5: card orders whose payment never settled hold stock. Cancel them after
 * CARD_PAYMENT_TTL_MINUTES. Called opportunistically (checkout, seller order
 * list) so no extra scheduler is needed; bounded per call.
 */
export async function expireUnpaidCardOrders(limit = 20): Promise<number> {
  const cutoff = new Date(Date.now() - getEnv().CARD_PAYMENT_TTL_MINUTES * 60_000)
  const stale = await db
    .select({ subOrderId: schema.subOrders.id })
    .from(schema.subOrders)
    .innerJoin(schema.payments, eq(schema.payments.orderId, schema.subOrders.orderId))
    .where(
      and(
        eq(schema.payments.method, "card"),
        inArray(schema.payments.state, ["requires_payment", "processing", "failed"]),
        lt(schema.payments.updatedAt, cutoff),
        eq(schema.subOrders.status, "pending"),
      ),
    )
    .limit(limit)
  let expired = 0
  for (const { subOrderId } of stale) {
    try {
      const effects = await db.transaction((tx) =>
        cancelSubOrderTx(tx, subOrderId, "Payment not completed in time", ["pending"]),
      )
      await runCancelEffects(effects)
      expired++
    } catch (err) {
      if (!(err instanceof AppError)) {
        console.error("[orders] unpaid-card expiry failed:", err)
      }
    }
  }
  return expired
}
