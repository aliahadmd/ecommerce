import { createFileRoute } from "@tanstack/react-router"
import { db, schema, eq } from "@ecommerce/db"
import * as paymentsPkg from "@ecommerce/payments"

/**
 * Fake gateway settle endpoint (plan-3). Signature-verified; the page at
 * /checkout/pay/$ref posts here. Real provider webhooks follow the same path.
 */
export const Route = createFileRoute("/api/payments/callback")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json()) as {
          ref?: unknown
          outcome?: unknown
          sig?: unknown
        }
        const ref = String(body.ref ?? "")
        const outcome = String(body.outcome ?? "")
        const sig = String(body.sig ?? "")
        if (!ref || !outcome || !sig) {
          return Response.json({ ok: false }, { status: 400 })
        }
        const verified = paymentsPkg.fakeProvider.verifyCallback({ ref, outcome, sig })
        if (!verified) {
          return Response.json({ ok: false }, { status: 401 })
        }
        const [payment] = await db
          .select()
          .from(schema.payments)
          .where(eq(schema.payments.providerRef, ref))
          .limit(1)
        if (!payment) return Response.json({ ok: false }, { status: 404 })
        if (payment.state === "succeeded") {
          return Response.json({ ok: true, state: "succeeded" })
        }
        const newState = outcome === "succeeded" ? "succeeded" : "failed"
        await db.transaction(async (tx) => {
          await tx
            .update(schema.payments)
            .set({ state: newState })
            .where(eq(schema.payments.id, payment.id))
          if (newState === "succeeded") {
            await tx
              .update(schema.subOrders)
              .set({ status: "confirmed" })
              .where(eq(schema.subOrders.orderId, payment.orderId))
            await tx
              .update(schema.orders)
              .set({ paymentStatus: "paid", status: "confirmed" })
              .where(eq(schema.orders.id, payment.orderId))
          }
        })
        return Response.json({ ok: true, state: newState })
      },
    },
  },
})
