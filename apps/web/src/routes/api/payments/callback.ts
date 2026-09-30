import { createFileRoute } from "@tanstack/react-router"
import { db, schema, eq } from "@ecommerce/db"
import * as paymentsPkg from "@ecommerce/payments"

/**
 * Payment gateway callback / webhook (plan-3). The active provider verifies
 * the raw body (fake: HMAC JSON from /pay/$ref; Stripe: signed webhook — point
 * the Stripe dashboard at this URL). Every verified event is recorded in
 * payment_events (unique event id) so replays are no-ops, and the transition
 * itself lives in exactly one place: settleCardPayment (plan 003).
 */
export const Route = createFileRoute("/api/payments/callback")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const rawBody = await request.text()
        const provider = paymentsPkg.getProvider()
        const event = await provider.verifyWebhook({
          rawBody,
          headers: request.headers,
        })
        if (!event) return Response.json({ ok: false }, { status: 401 })

        const [payment] = await db
          .select({ id: schema.payments.id, state: schema.payments.state })
          .from(schema.payments)
          .where(eq(schema.payments.providerRef, event.ref))
          .limit(1)
        if (!payment) return Response.json({ ok: false }, { status: 404 })

        const { settleCardPayment } = await import("@/server/payouts-internals")
        const state = await db.transaction(async (tx) => {
          const recorded = await tx
            .insert(schema.paymentEvents)
            .values({
              provider: provider.id,
              eventId: event.eventId,
              paymentId: payment.id,
              payload: rawBody.slice(0, 10_000),
            })
            .onConflictDoNothing()
            .returning({ id: schema.paymentEvents.id })
          if (recorded.length === 0) return payment.state // replayed event
          return settleCardPayment(tx, payment.id, event.outcome)
        })
        return Response.json({ ok: true, state: state ?? "failed" })
      },
    },
  },
})
