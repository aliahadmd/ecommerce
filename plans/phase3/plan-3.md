# Plan 3 — Online Payments

**Status:** Done
**Depends on:** plan-2 (sub-orders own fulfillment; payments settle the parent)
**Estimated effort:** 3 days

---

## Goal

Add **card payments** behind a provider abstraction with a dev **fake gateway** (no external service) and a **Stripe adapter** (test mode, activated by `STRIPE_SECRET_KEY`). COD remains a first-class method. Payments are recorded in a `payments` table; webhooks/callbacks settle them idempotently.

## Schema (migration: additive)

```sql
CREATE TYPE payment_method AS ENUM ('cod','card');
ALTER TABLE orders ALTER COLUMN payment_method DROP DEFAULT;
-- existing 'payment_method' enum already has 'cod'; extend or replace with the two-value enum
CREATE TYPE payment_status AS ENUM ('requires_payment','processing','succeeded','failed','refunded','partially_refunded','pending_on_delivery');

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE cascade,
  method payment_method NOT NULL,
  provider text NOT NULL,                 -- 'fake' | 'stripe'
  provider_ref text UNIQUE,               -- intent id
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL,
  status payment_status NOT NULL DEFAULT 'processing',
  refund_cents integer NOT NULL DEFAULT 0 CHECK (refund_cents >= 0),
  created_at/updated_at …
);
CREATE INDEX payments_order_idx ON payments (order_id);

CREATE TABLE payment_events (             -- idempotent webhook/event log
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL UNIQUE,          -- provider event id
  payment_id uuid REFERENCES payments(id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

COD migration: for every existing unpaid order insert a `payments` row (method cod, `pending_on_delivery`, amount = total). "Mark paid (cash)" now transitions this row to `succeeded` instead of mutating `orders.payment_status` (which becomes derived from payments).

## Provider abstraction (`packages/payments` — new package)

```ts
interface PaymentProvider {
  readonly id: "fake" | "stripe"
  createIntent(order, opts): Promise<{ ref: string; payUrl?: string; clientSecret?: string }>
  capture(ref): Promise<{ status: "succeeded" | "failed" }>
  refund(ref, amountCents): Promise<{ status: "refunded" | "partially_refunded" }>
  verifyWebhook(rawBody, signature): { eventId: string; ref: string; outcome: "succeeded" | "failed" } | null
}
```

- **FakeProvider** (`PAYMENT_PROVIDER=fake`, dev default): `payUrl = /checkout/pay/{ref}` — a local page with "Pay now" / "Simulate failure" buttons that hit a signed internal callback. Lets the full e2e flow run with no key.
- **StripeProvider**: `@stripe/stripe-js` + `stripe` server SDK; PaymentIntents; webhook signature verification. Only constructed when `STRIPE_SECRET_KEY` is set; the checkout UI uses `clientSecret` + Elements in that case, else redirects to the fake page.
- Selection via env: `PAYMENT_PROVIDER=fake|stripe`.

## Server functions (`server/payments.ts`)

| Function | Auth | Behavior |
| --- | --- | --- |
| `startCheckout({ orderId, method })` | buyer(own) | COD → order pending, payment row `pending_on_delivery`, sub-orders confirmable. Card → provider.createIntent, store ref, return payUrl/clientSecret |
| `getPaymentStatus({ orderId })` | buyer(own) | For polling the fake-gateway return page |
| `fakeGatewayCallback({ ref, outcome }, signature)` | signed (HMAC with BETTER_AUTH_SECRET-derived key) | Marks payment succeeded/failed, idempotent |
| `stripeWebhook(rawBody, sig)` | signature-verified | Insert `payment_events` (unique event_id — replay-safe), settle payment, trigger confirmation |
| `refundPayment({ orderId, amountCents? }, admin)` | admin (phase 3; sub-order-scoped refunds in a later phase) | Provider refund + payment row update + ledger entry (plan-5) |

On `succeeded`: parent order status `confirmed` (card orders skip the pending-confirm wait — payment IS confirmation), sub-orders → `confirmed`, confirmation emails, notification.

## UI

- **Checkout**: payment method selector (Cash on delivery / Card). Card + fake provider → "Pay now" button posts and redirects to the fake gateway page; Stripe → redirect to Stripe Checkout (test mode).
- **`/checkout/pay/$ref`**: fake-gateway page (clearly labeled "DEV GATEWAY") with Pay / Fail buttons.
- **Buyer order page**: payment status badge (Paid / Awaiting payment / COD — pay on delivery); "Pay now" retry button when `requires_payment`.
- **Admin order view**: payment rows per order with refs and refund button.

## Acceptance criteria

- [ ] COD flow unchanged end-to-end (existing e2e passes).
- [ ] Card checkout via fake gateway: intent → pay → callback → order confirmed + payment succeeded; "Simulate failure" leaves `requires_payment` with a retry path.
- [ ] Webhook/event replay is idempotent (double-delivery creates one settlement; `payment_events` unique holds).
- [ ] Callback without a valid signature is rejected 401.
- [ ] Stripe adapter: unit-tested with mocked SDK; compiles into the provider registry; live test-mode run documented in README (optional, key-gated).
- [ ] Refund (admin) marks payment `refunded` and notifies the buyer.
- [ ] Legacy orders backfilled with COD payment rows; "Mark paid" still works.

## Explicitly not in this plan

Sub-order-scoped partial refunds (follow-up), payment provider onboarding/KYC UI, saving cards, 3-D Secure edge cases beyond Stripe defaults.

---

## As-built note (2026-09-26)

COD backfill shipped in migration 0014 (payment rows for legacy orders). Stripe SDK loaded via variable dynamic import (optional peer, not a compile dep). Fake gateway callbacks HMAC-signed with BETTER_AUTH_SECRET-derived key.


## As-built addendum (2026-09-27)

Fake-gateway page moved from `/checkout/pay/$ref` to top-level `/pay/$ref`: `checkout.tsx` acts as a layout for the `checkout/` route folder and has no `<Outlet/>`, so the nested pay route never rendered (the checkout page's empty-cart branch showed instead). `fakeProvider.createIntent`, the resume-payment `payUrl` in `server/payments.ts`, and the callback doc comment updated to match. Covered by the new card-payment e2e spec (place → gateway → Pay now → order paid).
