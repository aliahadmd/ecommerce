# Plan 2 — Per-Seller Sub-Orders

**Status:** Done
**Depends on:** — (foundational for plans 3–5)
**Estimated effort:** 3 days — the largest plan of phase 3

---

## Goal

A multi-seller checkout splits into **per-shop sub-orders**. Each seller fulfills only their slice with independent status transitions; the buyer sees per-seller tracking; cancellations and (in plan-3) refunds become seller-scoped. This retires the phase-2 documented simplification.

## Schema (migration: additive + backfill)

```sql
CREATE TYPE sub_order_status AS ENUM ('pending','confirmed','shipped','delivered','cancelled');

CREATE TABLE sub_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE restrict,
  status sub_order_status NOT NULL DEFAULT 'pending',
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  shipping_cents  integer NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  discount_cents  integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents     integer NOT NULL CHECK (total_cents >= 0),
  cancel_reason   text,
  created_at/updated_at timestamptz …,
  CONSTRAINT sub_orders_order_shop_unique UNIQUE (order_id, shop_id)
);
CREATE INDEX sub_orders_shop_idx ON sub_orders (shop_id, status, created_at);

ALTER TABLE order_items ADD COLUMN sub_order_id uuid REFERENCES sub_orders(id) ON DELETE CASCADE;
```

**Backfill (same migration):** for each legacy order, insert one sub-order per distinct shop in its items, summing item totals; allocate shipping to the first sub-order; stamp `sub_order_id` on its items.

**Aggregate parent status:** `orders.status` becomes maintained — after any sub-order transition, recompute: all cancelled → cancelled; all delivered → delivered; else the earliest non-terminal stage (`pending < confirmed < shipped < delivered`), ignoring cancelled sub-orders once at least one is active. Implemented as `recomputeOrderStatus(tx, orderId)` in `server/internals.ts` and called in the same transaction as every sub-order transition (same pattern as the plan-5 aggregates).

## State machine

Reuses the phase-1 matrix per sub-order (`lib/order-machine.ts` gains `SubOrderStatus` actions). Cancellation restores stock **for that sub-order's items only**; if a card payment is captured, a refund line is queued (plan-3); COD orders just re-mark.

## Server functions (`server/sub-orders.ts`, edits to `commerce.ts`)

| Function | Auth | Behavior |
| --- | --- | --- |
| `listShopSubOrders({ status?, page })` | seller | Own shop's sub-orders w/ item counts — replaces `listShopOrders` |
| `getSubOrderDetail({ subOrderId })` | buyer(own) / seller(own shop) / admin | Sub-order + items + parent address |
| `updateSubOrderStatus({ subOrderId, status, reason? })` | seller(own)/admin | Matrix-checked transition + stock restore on cancel + parent recompute |
| `cancelSubOrder` folded into update | buyer(own, pending) / seller / admin | as today but scoped |
| `listMyOrders` / `getMyOrder` | buyer | Return parent order with sub-order sections (status per shop) |

`placeOrder` (commerce.ts): after inserting the parent order + items, group items by `shopId`, insert sub-orders (proportional shipping allocation — first sub-order gets the remainder so cents sum exactly), stamp `sub_order_id` on items. Emails and notifications key off sub-orders.

## UI

- **Buyer** `/account/orders/$id`: order header (totals, payment, address) + one card **per sub-order** with per-seller status badge, per-shop items, and its own cancel button while pending.
- **Seller** `/seller/orders`: now lists **sub-orders** (their shop only) — columns/status/actions unchanged from phase 2; detail dialog shows only their items.
- **Admin** `/admin/orders`: parent orders with expandable sub-order rows; admin can force-cancel a sub-order.
- **Order emails**: subject/body name the shop ("Your order from Nova Gadgets is shipped").

## Acceptance criteria

- [ ] Fresh 2-seller checkout creates 1 order + 2 sub-orders; each seller sees only their sub-order; totals reconcile (sub-order totals sum = order total).
- [ ] Seller A delivers while seller B is still pending; buyer sees per-seller statuses; parent shows "partially fulfilled" derived state.
- [ ] Buyer cancels seller B's pending sub-order → only B's stock restored; A's sub-order unaffected; parent reflects remaining active sub-orders.
- [ ] Legacy seeded orders render identically after the backfill (spot-check vs phase-2 screenshots).
- [ ] `recomputeOrderStatus` is unit-tested over every combination (pure function).
- [ ] All existing order e2e specs still pass (updated to the sub-order UI).

## Explicitly not in this plan

Per-sub-order payments/refunds (plan-3), per-sub-order shipping fees beyond the allocation rule (plan-4/5 refine), partial item-level cancellations.

---

## As-built note (2026-09-26)

As planned. Backfill shipped inside migration 0013 (synthetic sub-orders per shop; shipping to first). Parent status derived via recomputeOrderStatus.
