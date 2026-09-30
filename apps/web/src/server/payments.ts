import { createServerFn } from "@tanstack/react-start"
import { db, schema, and, desc, eq } from "@ecommerce/db"
import * as paymentsPkg from "@ecommerce/payments"
import { AppError, guard, requireRole, requireUser } from "./session"

/**
 * Create, reuse or retry the payment for an order (plan 002).
 * - succeeded/refunded payments are final — never re-opened
 * - a failed card attempt gets a fresh intent (retry)
 * - COD ↔ card switches update the single row in place
 * - cancelled orders cannot be paid (plan 003)
 */
export const startCheckoutPayment = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const orderId = String((input as { orderId?: unknown })?.orderId ?? "")
    const method = String((input as { method?: unknown })?.method ?? "cod")
    if (!orderId) throw new AppError("INVALID", "orderId required")
    if (method !== "cod" && method !== "card") {
      throw new AppError("INVALID", "Invalid payment method")
    }
    return { orderId, method }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const { assertStoreOpen } = await import("./settings-internals")
      await assertStoreOpen(user)
      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, data.orderId))
        .limit(1)
      if (!order) throw new AppError("NOT_FOUND", "Order not found")
      if (order.buyerId !== user.id) throw new AppError("FORBIDDEN", "Not your order")
      if (order.status === "cancelled") {
        throw new AppError("INVALID", "This order was cancelled")
      }

      const [existing] = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, order.id))
        .limit(1)
      // money-safety rail: a captured payment is never re-opened
      if (
        existing &&
        ["succeeded", "partially_refunded", "refunded"].includes(existing.state)
      ) {
        return { method: existing.method, payUrl: "" }
      }
      const { deriveOrderPaymentStatus } = await import("./payouts-internals")

      if (data.method === "cod") {
        if (existing?.method === "cod") return { method: "cod" as const, payUrl: "" }
        const cod = {
          orderId: order.id,
          method: "cod" as const,
          provider: "fake",
          providerRef: null,
          amountCents: order.totalCents,
          currency: order.currency,
          state: "pending_on_delivery" as const,
        }
        await db.transaction(async (tx) => {
          if (existing) {
            await tx.update(schema.payments).set(cod).where(eq(schema.payments.id, existing.id))
          } else {
            await tx.insert(schema.payments).values(cod)
          }
          await tx
            .update(schema.orders)
            .set({ paymentMethod: "cod" })
            .where(eq(schema.orders.id, order.id))
          await deriveOrderPaymentStatus(tx, order.id)
        })
        return { method: "cod" as const, payUrl: "" }
      }

      const provider = paymentsPkg.getProvider()
      // the fake gateway's intents are stateless refs → reuse a live one
      if (
        existing?.method === "card" &&
        existing.state === "requires_payment" &&
        existing.providerRef &&
        provider.id === "fake"
      ) {
        return { method: "card" as const, payUrl: `/pay/${existing.providerRef}` }
      }

      const ref = `PAY-${order.orderNumber}-${Date.now().toString(36)}`
      const intent = await provider.createIntent({
        ref,
        amountCents: order.totalCents,
        currency: order.currency,
        description: `Order ${order.orderNumber}`,
      })
      const card = {
        orderId: order.id,
        method: "card" as const,
        provider: provider.id,
        providerRef: ref,
        amountCents: order.totalCents,
        currency: order.currency,
        state: "requires_payment" as const,
      }
      await db.transaction(async (tx) => {
        if (existing) {
          await tx.update(schema.payments).set(card).where(eq(schema.payments.id, existing.id))
        } else {
          await tx.insert(schema.payments).values(card)
        }
        await tx
          .update(schema.orders)
          .set({ paymentMethod: "card" })
          .where(eq(schema.orders.id, order.id))
        await deriveOrderPaymentStatus(tx, order.id)
      })
      return { method: "card" as const, payUrl: intent.payUrl }
    }),
  )

/**
 * Sign a fake-gateway callback (the secret never reaches the client). Only
 * the order's own buyer (or an admin) may sign, and only while the fake
 * gateway is the active provider (plan 006, M10).
 */
export const signCallback = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { ref?: unknown; outcome?: unknown }
    const ref = String(raw.ref ?? "")
    const outcome = String(raw.outcome ?? "")
    if (!ref || !["succeeded", "failed"].includes(outcome)) {
      throw new AppError("INVALID", "ref and outcome required")
    }
    return { ref, outcome }
  })
  .handler(({ data }) =>
    guard(async () => {
      if (!paymentsPkg.isFakeGateway()) {
        throw new AppError("NOT_FOUND", "Payment not found")
      }
      const user = await requireUser()
      const [row] = await db
        .select({ buyerId: schema.orders.buyerId })
        .from(schema.payments)
        .innerJoin(schema.orders, eq(schema.payments.orderId, schema.orders.id))
        .where(eq(schema.payments.providerRef, data.ref))
        .limit(1)
      if (!row) throw new AppError("NOT_FOUND", "Payment not found")
      if (row.buyerId !== user.id && user.role !== "super_admin") {
        throw new AppError("FORBIDDEN", "Not your payment")
      }
      return { sig: paymentsPkg.signFakeCallback(data.ref, data.outcome) }
    }),
  )

/**
 * "Cash received" — COD settlement (plan 006). Admins may reconcile any live
 * order; a seller only an order where their own sub-order was delivered
 * (cash is collected on delivery — see canMarkPaid in lib/order-machine).
 */
export const markCodPaid = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const orderId = String((input as { orderId?: unknown })?.orderId ?? "")
    if (!orderId) throw new AppError("INVALID", "orderId required")
    return { orderId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireRole("seller", "super_admin")
      const [order] = await db
        .select({ status: schema.orders.status })
        .from(schema.orders)
        .where(eq(schema.orders.id, data.orderId))
        .limit(1)
      if (!order) throw new AppError("NOT_FOUND", "Order not found")
      if (order.status === "cancelled") {
        throw new AppError("INVALID", "This order was cancelled")
      }
      if (user.role !== "super_admin") {
        const [shop] = await db
          .select({ id: schema.shops.id })
          .from(schema.shops)
          .where(eq(schema.shops.ownerId, user.id))
          .limit(1)
        if (!shop) throw new AppError("FORBIDDEN", "No shop found for this account")
        const [own] = await db
          .select({ status: schema.subOrders.status })
          .from(schema.subOrders)
          .where(
            and(
              eq(schema.subOrders.orderId, data.orderId),
              eq(schema.subOrders.shopId, shop.id)
            )
          )
          .limit(1)
        if (!own) {
          throw new AppError("FORBIDDEN", "This order has no sub-order from your shop")
        }
        if (own.status !== "delivered") {
          throw new AppError("INVALID", "Mark the order delivered before recording the cash")
        }
      }

      await db.transaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(schema.payments)
          .where(eq(schema.payments.orderId, data.orderId))
          .for("update")
          .limit(1)
        if (!payment || payment.method !== "cod") {
          throw new AppError("INVALID", "This is not a cash-on-delivery order")
        }
        if (payment.state === "succeeded") return // idempotent
        if (payment.state !== "pending_on_delivery") {
          throw new AppError("INVALID", "This payment can no longer be collected")
        }
        await tx
          .update(schema.payments)
          .set({ state: "succeeded" })
          .where(eq(schema.payments.id, payment.id))
        const { deriveOrderPaymentStatus } = await import("./payouts-internals")
        await deriveOrderPaymentStatus(tx, data.orderId)
      })
      return { ok: true }
    }),
  )

export const listMyPayments = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireUser()
    return db
      .select({
        orderId: schema.payments.orderId,
        method: schema.payments.method,
        state: schema.payments.state,
        amountCents: schema.payments.amountCents,
        currency: schema.payments.currency,
      })
      .from(schema.payments)
      .innerJoin(schema.orders, eq(schema.payments.orderId, schema.orders.id))
      .where(eq(schema.orders.buyerId, user.id))
      .orderBy(desc(schema.payments.createdAt))
      .limit(50)
  }),
)
