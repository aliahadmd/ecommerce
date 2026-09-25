# Plan 8 — Cart, Checkout & COD Orders

**Status:** Done
**Depends on:** plan-7 (products)
**Estimated effort:** 2 days

---

## Goal

Buyer adds to cart, checks out with a shipping address, pays **cash on delivery**; seller fulfills and marks payment collected by hand. This implements the phase-1 order + payment model from plan-1 §3.

## Status & permission matrix

`order_status`: `pending → confirmed → shipped → delivered`, with `cancelled` reachable from `pending`/`confirmed`. `payment_status`: `unpaid → paid` (or `void` on cancel).

| Transition | Who | When |
| --- | --- | --- |
| create (→ pending, unpaid, cod) | buyer (system at checkout) | checkout |
| pending → confirmed | seller (own shop) / admin | accepted the order |
| confirmed → shipped | seller / admin | handed to courier |
| shipped → delivered | seller / admin | delivered |
| delivered + `payment_status: unpaid → paid` | seller / admin | **cash received by hand** ("Mark paid" button) |
| → cancelled (reason required) | buyer (own, pending/confirmed only), seller (own shop items' orders), admin (any) | restore stock |
| payment → `void` | system on cancel | — |

Illegal transitions are rejected server-side with a typed error; the UI only ever offers legal next actions.

## Server functions (`apps/web/src/server/cart.ts`, `.../orders.ts`)

**Cart** (login required — guests are prompted to register; guest carts deliberately deferred):

- `getCart()` — items joined with product data, validates items still active/in-stock, returns subtotal.
- `addToCart({ productId, quantity })` — stock check; upsert on `(cartId, productId)` (plan-4 unique index).
- `updateCartItem({ itemId, quantity })` / `removeCartItem({ itemId })` / `clearCart()`.

**Checkout** — `placeOrder({ addressId | newAddress, shippingFeeCents? })` in **one transaction**:

1. Load cart with `FOR UPDATE` on product rows.
2. Re-validate: product `active`, shop `active`, `stock >= quantity`, price re-read from DB (never trusted from client).
3. For each item: `UPDATE products SET stock = stock - qty WHERE id = $1 AND stock >= qty` — affected-rows check; abort + rollback on any failure ("Item X only has N left").
4. Insert `orders` (status `pending`, payment `cod`/`unpaid`, address snapshot copied from `addresses`) + `order_items` (full snapshot columns).
5. Delete cart items. Commit.
6. After commit: emails (buyer + seller) via Mailpit (plan: fire-and-forget with log on failure — queue worker comes in a later phase).

Order number: `ORD-YYYYMMDD-####` from a daily counter (table or `nextval` sequence).

**Order management**:

- `listMyOrders` / `getMyOrder(id)` — buyer scope.
- `listShopOrders` — seller scope (`order_items.shop_id`), paginated for TanStack Table.
- `listAllOrders` — admin.
- `updateOrderStatus({ orderId, status })` — matrix enforced (a seller transitions only orders containing their items, and only while every other seller's items… simplified for phase 1: an order is fulfilled per-order, mixed-seller carts are allowed, seller sees and advances the order but admin is the tie-breaker; document this simplification).
- `markOrderPaid({ orderId })` — seller/admin, only when `delivered` (admin may also mark paid earlier for manual reconciliation).
- `cancelOrder({ orderId, reason })` — matrix above; transaction restores stock, sets `payment_status = void`.

## Emails (packages/email templates)

| Event | To | Template |
| --- | --- | --- |
| Order placed | buyer + seller | items, totals, delivery address, "pay cash on delivery" note |
| Status changed | buyer | confirmed / shipped / delivered |
| Payment marked paid | buyer | receipt-style summary |
| Cancelled | buyer (+ seller when admin/buyer cancelled) | reason |

All render via react-email, sent through Mailpit — visible at http://localhost:8025.

## Pages

| Route | Access | Contents |
| --- | --- | --- |
| `/cart` | user | line items (thumb, price, qty stepper, remove), subtotal, checkout CTA; stale-item warnings |
| `/checkout` | user | address picker (saved addresses from plan-5 + add-new form), order summary, "Payment: Cash on delivery" panel, place-order button |
| `/account/orders` | buyer | list with status badges, cancel button where legal |
| `/account/orders/$id` | buyer | full detail: items, address snapshot, status timeline, totals, "pay on delivery" notice |
| `/seller/orders` | seller | TanStack Table of orders containing their items; detail drawer/page with action buttons per matrix |
| `/admin/orders` | admin | all orders + same actions + force cancel |

Header cart badge (TanStack Store) updates from cart mutations.

## Acceptance criteria

- [ ] Happy path: buyer adds 2 products from 2 sellers → checkout → order `pending` → seller confirms → ships → delivers → marks paid → buyer sees paid. Stock decremented at each step's start (once, at checkout).
- [ ] Over-sell attempt (buy 5 with stock 3, or two tabs racing) → transaction aborts with a clear message, no partial order.
- [ ] Buyer cancels while pending → stock restored, seller sees cancelled.
- [ ] Seller cannot confirm another shop's order (403); admin can.
- [ ] "Mark paid" only appears/enables for `delivered` (admin override noted); payment badge updates.
- [ ] All five emails appear in Mailpit with correct data.
- [ ] Editing a product's price after checkout does not change the order's totals (snapshot proof).
- [ ] Unauthenticated add-to-cart redirects to login with redirect back.

## Explicitly not in this plan

Online payments (the `payment_method` enum + `paymentStatus` machine is the seam where a gateway slots in later), per-seller sub-order splitting (simplification documented above), guest checkout, shipping-fee calculation rules (flat/env-configured fee, default 0).

---

## As-built note (2026-09-25)

As planned: DB-backed cart, transactional checkout with atomic stock decrement (`stock >= qty` guard), COD lifecycle with permission matrix, cancellation with stock restore, and all five email flows — verified end-to-end in the browser (buyer order → seller confirm/ship/deliver/mark-paid, 6 emails in Mailpit, stock 200→199). Deltas: seller order detail is a dialog on the orders table rather than a separate page; guest carts and per-seller sub-orders remain deferred as noted.
