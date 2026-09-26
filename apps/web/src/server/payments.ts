import { createServerFn } from "@tanstack/react-start"
import { db, schema, and, desc, eq } from "@ecommerce/db"
import { signFakeCallback } from "@ecommerce/payments"
import * as paymentsPkg from "@ecommerce/payments"
import { AppError, guard, requireRole, requireUser } from "./session"

const FAKE = "fake"

/** Create (or reuse) the payment row for an order. COD stays cash-based. */
export const startCheckoutPayment = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const orderId = String((input as { orderId?: unknown })?.orderId ?? "")
    const method = String((input as { method?: unknown })?.method ?? "cod")
    if (!orderId) throw new AppError("INVALID", "orderId required")
    if (method !== "cod" && method !== "card") {
      throw new AppError("INVALID", "Invalid payment method")
    }
    return { orderId, method: method as "cod" | "card" }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, data.orderId))
        .limit(1)
      if (!order) throw new AppError("NOT_FOUND", "Order not found")
      if (order.buyerId !== user.id) throw new AppError("FORBIDDEN", "Not your order")

      const [existing] = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, order.id))
        .limit(1)
      if (existing) {
        if (existing.method === "card" && existing.providerRef && existing.state === "requires_payment") {
          const provider = paymentsPkg.getProvider()
          return {
            method: "card" as const,
            payUrl: provider.id === FAKE ? `/checkout/pay/${existing.providerRef}` : "",
          }
        }
        return { method: existing.method as "cod" | "card", payUrl: "" }
      }

      if (data.method === "cod") {
        await db.insert(schema.payments).values({
          orderId: order.id,
          method: "cod",
          provider: FAKE,
          amountCents: order.totalCents,
          currency: order.currency,
          state: "pending_on_delivery",
        })
        return { method: "cod" as const, payUrl: "" }
      }

      const provider = paymentsPkg.getProvider()
      const ref = `PAY-${order.orderNumber}-${Date.now().toString(36)}`
      const intent = await provider.createIntent({
        ref,
        amountCents: order.totalCents,
        currency: order.currency,
        description: `Order ${order.orderNumber}`,
      })
      await db.insert(schema.payments).values({
        orderId: order.id,
        method: "card",
        provider: provider.id,
        providerRef: ref,
        amountCents: order.totalCents,
        currency: order.currency,
        state: "requires_payment",
      })
      void provider
      return { method: "card" as const, payUrl: intent.payUrl }
    }),
  )

/** Fake-gateway callback: HMAC-verified, idempotent. */
export const fakeGatewayCallback = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { ref?: unknown; outcome?: unknown; sig?: unknown }
    const ref = String(raw.ref ?? "")
    const outcome = String(raw.outcome ?? "")
    const sig = String(raw.sig ?? "")
    if (!ref || !outcome || !sig) throw new AppError("INVALID", "Missing fields")
    return { ref, outcome, sig }
  })
  .handler(({ data }) =>
    guard(async () => {
      const verified = paymentsPkg.fakeProvider.verifyCallback(data)
      if (!verified) throw new AppError("UNAUTHORIZED", "Invalid callback signature")
      const outcome = verified.outcome
      const [payment] = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.providerRef, data.ref))
        .limit(1)
      if (!payment) throw new AppError("NOT_FOUND", "Payment not found")
      if (payment.state === "succeeded") return { ok: true, state: "succeeded" as const }

      const newState = outcome === "succeeded" ? "succeeded" : "failed"
      await db.transaction(async (tx) => {
        await tx
          .update(schema.payments)
          .set({ state: newState })
          .where(eq(schema.payments.id, payment.id))
        if (newState === "succeeded") {
          // paid card orders skip the seller-confirm wait: mark sub-orders confirmed
          await tx
            .update(schema.subOrders)
            .set({ status: "confirmed" })
            .where(
              and(
                eq(schema.subOrders.orderId, payment.orderId),
                eq(schema.subOrders.status, "pending")
              )
            )
          await tx
            .update(schema.orders)
            .set({ paymentStatus: "paid", status: "confirmed" })
            .where(eq(schema.orders.id, payment.orderId))
        }
      })
      return { ok: true, state: newState }
    }),
  )

/** Sign a fake-gateway callback (the secret never reaches the client). */
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
      await requireUser()
      return { sig: signFakeCallback(data.ref, data.outcome) }
    }),
  )

/** "Mark paid (cash)" — COD settlement on delivery. */
export const markCodPaid = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const orderId = String((input as { orderId?: unknown })?.orderId ?? "")
    if (!orderId) throw new AppError("INVALID", "orderId required")
    return { orderId }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("seller", "super_admin")
      await db
        .update(schema.payments)
        .set({ state: "succeeded" })
        .where(
          and(
            eq(schema.payments.orderId, data.orderId),
            eq(schema.payments.method, "cod")
          )
        )
      await db
        .update(schema.orders)
        .set({ paymentStatus: "paid" })
        .where(eq(schema.orders.id, data.orderId))
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
