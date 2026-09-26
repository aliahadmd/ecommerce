# Plan 4 — Coupons & Promotions

**Status:** Done
**Depends on:** plan-2 (sub-orders for discount allocation)
**Estimated effort:** 2 days

---

## Goal

Promo codes apply at cart, respect limits and validity windows, and their discount is **allocated deterministically** across sub-orders and line items so seller payouts (plan-5) reconcile to the cent.

## Schema (migration: additive)

```sql
CREATE TYPE discount_kind AS ENUM ('percent','fixed','free_shipping');

CREATE TABLE coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,                    -- stored uppercase, compared case-insensitive
  kind discount_kind NOT NULL,
  value integer NOT NULL CHECK (value > 0),     -- percent 1..100, or cents for fixed
  shop_id uuid REFERENCES shops(id) ON DELETE cascade,   -- null = marketplace-wide
  min_subtotal_cents integer NOT NULL DEFAULT 0 CHECK (min_subtotal_cents >= 0),
  max_uses integer,                             -- null = unlimited
  max_uses_per_user integer NOT NULL DEFAULT 1 CHECK (max_uses_per_user > 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at/updated_at …,
  CHECK (kind <> 'percent' OR value <= 100)
);

CREATE TABLE coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE cascade,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE cascade,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coupon_redemptions_coupon_user_idx ON coupon_redemptions (coupon_id, user_id);
```

## Server functions (`server/coupons.ts`)

| Function | Auth | Behavior |
| --- | --- | --- |
| `validateCoupon({ code, cartSubtotalCents, shopIds })` | user | Returns `{ coupon, discountCents }` or `{ valid: false, reason }` — checks window, min subtotal, shop scope (cart must contain that shop's items), per-user usage, global max_uses. Pure check, no writes |
| `applyCoupon({ code })` | user | Validates then stores `coupons.couponId` on the user's cart row (new `cart.coupon_id` column) — the cart owns the applied coupon |
| `removeCoupon()` | user | Clears it |
| admin: `createCoupon` / `updateCoupon` / `deleteCoupon` / `listCoupons({ page })` | super_admin | CRUD with usage stats (redemption count) |

**Settlement in `placeOrder`** (inside the checkout transaction):
1. Re-validate (window/limits/scope) and compute `discount = f(subtotal)`; never exceed subtotal.
2. Insert `coupon_redemptions` (per-user limit enforced by `count(*)` inside the tx; unique-ish race guarded by re-check + coupon row lock `FOR UPDATE`).
3. Allocate: parent `orders.discount_cents = discount`; sub-order discount shares = `floor(sub_order_subtotal / subtotal * discount)` with largest-remainder remainder to the first; item-level allocation for plan-5 ledger (same method).
4. Fixed + free_shipping only apply when scope matches (free_shipping zeroes the shipping allocation of the scoped/sub-order side).

## UI

- **Cart**: coupon input row — applies, shows discount line + code chip with remove; invalid codes show the reason inline.
- **Checkout**: discount line between subtotal and total.
- **Order page/emails**: discount line + code.
- **Admin** `/admin/coupons`: table (code, kind/value, scope, window, usage/max), create/edit dialog (code, kind, value, shop scope select, min subtotal, max uses, per-user limit, dates), deactivate (delete).
- **Seller**: shop-scoped coupons owned by admin-created scope are visible read-only in seller dashboard "Marketing" card (later phase: seller-created coupons).

## Acceptance criteria

- [ ] Percent coupon: $80 cart with 10% code → $8 off; line allocation sums to exactly 800 cents across sub-orders (largest-remainder asserted in unit test).
- [ ] Fixed coupon larger than subtotal → discount capped at subtotal; total never negative.
- [ ] Shop-scoped coupon applies only when that shop's items are in the cart; marketplace coupon applies to any cart.
- [ ] max_uses stops accepting at the limit (concurrent final redemptions: tx lock keeps count exact); per-user limit enforced.
- [ ] Expired/not-yet-valid/min-subtotal failures return the specific reason.
- [ ] Coupon survives checkout retry (order-number collision path) without double redemption.
- [ ] Admin CRUD works; usage counts update.
- [ ] Unit tests for the allocation function (property: sum of parts == discount, for 1–3 sub-orders, random totals).

## Explicitly not in this plan

Auto-applied promotions, sale prices on products, buy-X-get-Y, seller-created coupons (phase 4 candidates).

---

## As-built note (2026-09-26)

As planned. Discount allocated across sub-orders with remainder-to-last; coupon redemption written inside checkout tx.
