# Plan 1 — Phase 3 Overview & Architecture

**Status:** Draft — awaiting approval
**Depends on:** Phase 2 complete (all plans Done, audit fixes applied, e2e 8/8)
**Date:** 2026-09-26

---

## 1. Phase 3 theme: marketplace operations & monetization

Phase 1 built the marketplace; phase 2 built the catalog. Phase 3 makes it **operable and monetizable** — the pieces a real multi-vendor marketplace needs to run a business:

1. **Per-seller sub-orders** — the largest deferral from phases 1–2. A multi-seller checkout splits into per-shop sub-orders so each seller fulfills (and gets paid for) only their slice, independently.
2. **Online payments** — a payment-provider abstraction with a dev fake gateway and a Stripe adapter (test mode). COD remains a payment method; card payments become available.
3. **Coupons & promotions** — codes with percent/fixed discounts, scope (global/shop), usage limits, validity windows, cart-level application with proportional allocation across sub-orders.
4. **Seller payouts & ledger** — an immutable earnings ledger per order item (gross, commission, net), seller statements, admin payout runs.
5. **Background jobs & notifications** — BullMQ on the existing Redis; queued transactional email; an in-app notification center; back-in-stock alerts for wishlist items.
6. **CSV import** — products import with column mapping and dry-run validation (round-trips phase-2's export).
7. **Admin settings & moderation upgrades** — settings table (store open/maintenance, signups toggle, commission rate), review abuse reporting + photo reviews.
8. **CI/CD** — GitHub Actions running the full gate suite (typecheck, unit, e2e with service containers, build) and Docker image publish.

**Explicitly deferred (plan-10):** i18n, multi-currency display, semantic search, digital products, mobile, review Q&A at scale, real Stripe production keys.

---

## 2. Architectural decisions

### 2.1 Order splitting: parent order + per-shop sub-orders

Keep `orders` as the **buyer-facing checkout unit** (one row per checkout, owns totals/address/payment) and introduce `sub_orders` (one per shop in the cart) that own **fulfillment status** and **seller-scoped money**:

```
orders (buyer_id, address snapshot, payment, totals, coupon, status=aggregate)
  └─ sub_orders (order_id, shop_id, status, subtotal/ shipping/ discount share, unique(order_id, shop_id))
       └─ order_items.sub_order_id (moved from order-only)
```

- **Fulfillment actions move to sub-order level**: confirm → ship → delivered per shop; buyer sees per-seller tracking sections. Aggregate order status = worst-of derived (computed, not stored).
- **Cancellation**: buyer may cancel a pending sub-order; the parent is `cancelled` only when all sub-orders are. Stock restore + refunds become sub-order-scoped (unblocks the phase-2 simplification).
- **Migration**: existing orders get one synthetic sub-order (shop = the order's item set; multi-shop legacy orders get one sub-order per shop). Order history renders identically.
- **Invariant**: every mutation that today mutates `orders.status` moves to `sub_orders`; `orders.status` becomes a computed column maintained transactionally (derived from its sub-orders) to keep reads cheap.

### 2.2 Payments: provider abstraction, ledger as source of truth

```
payments (order_id, method cod|card, provider, provider_ref, amount_cents, status, timestamps)
PaymentProvider interface: createIntent(order) → {ref, clientSecret?}; capture(ref); refund(ref, amount)
Providers: FakeProvider (dev, simulates authorize/capture/webhook), StripeProvider (test mode when STRIPE_SECRET_KEY set)
```

- COD path unchanged: a `payments` row with method=cod, status=`pending_on_delivery`; "Mark paid" transitions it to `paid` (cash captured offline).
- Card path: intent created at checkout → redirect/confirm UI (Stripe Elements or fake-gateway page) → provider webhook (or fake-gateway callback) → `payments.status = succeeded` → order confirms. Webhooks verified by signature; processed **idempotently** (unique provider_ref + event id table).
- Refunds flow through the same provider; sub-order refunds are partial refunds of the parent payment.

### 2.3 Coupons: allocation must be deterministic

A coupon discount is stored once on `orders.discount_cents` and **allocated proportionally to sub-orders and line items** (largest-remainder so cents sum exactly). Ledger entries net the allocated discount. Deterministic allocation is what makes payouts reconcile to the cent.

### 2.4 Jobs: BullMQ on the existing Redis

- `packages/jobs` package: queue producers (`enqueueEmail`, `enqueueNotification`) and workers (`apps/web/jobs.worker.ts` or a separate `apps/worker` — decided: a **separate worker process** `apps/worker` started via `pnpm worker`, so web stays responsive and jobs scale independently).
- All transactional email moves from fire-and-forget inline sends to the queue with retries (exponential backoff ×5) — fixes the phase-1 "log and move on" gap properly.
- Webhook processing also goes through a queue (retry-safe).

### 2.5 Settings: typed key-value table with cached reads

`settings(key text pk, value jsonb, updated_at)`; `getSetting`/`setSetting` server fns; `listSettings` cached via the phase-2 `cachedJson`. Commission rate lives here (default 10%).

---

## 3. Plan index (execution order)

| Plan | Title | Depends on |
| --- | --- | --- |
| plan-1 | Overview & architecture (this file) | — |
| plan-2 | Per-seller sub-orders | — |
| plan-3 | Online payments | plan-2 |
| plan-4 | Coupons & promotions | plan-2 |
| plan-5 | Seller payouts & ledger | plan-2, plan-3 |
| plan-6 | Background jobs, email queue & notifications | — |
| plan-7 | CSV import | — |
| plan-8 | Admin settings & moderation upgrades | plan-5 (commission setting) |
| plan-9 | CI/CD & quality uplift | plans 2–8 |
| plan-10 | Stretch & deferred | — |

plan-2 first (foundational). plan-3/4/5 sequential (all touch the checkout). plan-6/7/8 independent — can run in parallel with 3–5 by a second workstream. plan-9 last.

---

## 4. Best practices adopted

1. **Money math is integer-only and reconciles**: proportional discount allocation uses largest-remainder; every ledger sum equals the parent total to the cent (asserted in tests).
2. **Idempotency everywhere money or webhooks move**: unique constraints on provider refs and event ids; handlers safe to replay.
3. **Status transitions stay in one place**: sub-order state machine mirrors phase-1's matrix (extracted to a shared module) — aggregate derivation is a pure, unit-tested function.
4. **Migrations are additive with backfills** (synthetic sub-orders for legacy orders), same as phase 2.
5. **No provider lock-in**: Stripe specifics never leak past `PaymentProvider`; the fake gateway is the dev/test default so e2e needs no external service or key.
6. **Jobs are at-least-once** → every job handler is idempotent (dedupe keys on (type, entity id)).
7. **Every plan carries its tests**; plan-9 consolidates the regression specs for split orders, coupons, refunds, and webhook replay.

---

## 5. Phase 3 definition of done

- [ ] Multi-seller checkout produces independent per-shop sub-orders; sellers act only on their slice; buyer sees per-seller status.
- [ ] Card checkout via the fake gateway works end-to-end (intent → pay → webhook → paid); Stripe adapter compiles and is exercised against test mode when a key is present.
- [ ] COD and card both produce ledger entries; refunds (full/partial) flow through the provider abstraction.
- [ ] Coupons apply at cart, allocate deterministically across sub-orders, and respect limits/windows.
- [ ] Sellers have a statement page (earnings, commission, payouts) and admin can run payout marks.
- [ ] Email is queued with retries; in-app notification center exists; back-in-stock alerts fire.
- [ ] CSV import: mapping UI + dry-run report + commit; bad rows never half-import.
- [ ] Admin settings control maintenance mode, signups, and commission rate.
- [ ] GitHub Actions runs the full gate suite on PR and publishes the Docker image on main.
- [ ] Gates stay green: typecheck, Vitest, lint, Playwright, health.
