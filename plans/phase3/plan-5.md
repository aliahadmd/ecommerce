# Plan 5 — Seller Payouts & Ledger

**Status:** Draft — awaiting approval
**Depends on:** plan-2 (sub-orders), plan-3 (payment settlement), plan-8 (commission setting read)
**Estimated effort:** 2 days

---

## Goal

Every order item produces an **immutable ledger entry** (gross, commission, net) the moment its sub-order is delivered/paid. Sellers get a statement page; admins mark payout runs. The ledger is append-only — corrections are new entries, never edits.

## Schema (migration: additive)

```sql
CREATE TYPE ledger_kind AS ENUM ('sale','refund','adjustment','payout');

CREATE TABLE seller_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE restrict,
  sub_order_id uuid REFERENCES sub_orders(id) ON DELETE set null,
  order_id uuid REFERENCES orders(id) ON DELETE set null,
  kind ledger_kind NOT NULL,
  gross_cents integer NOT NULL CHECK (gross_cents >= 0),
  commission_cents integer NOT NULL CHECK (commission_cents >= 0),
  net_cents integer NOT NULL CHECK (net_cents >= 0),
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_ledger_shop_idx ON seller_ledger (shop_id, created_at);

CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE restrict,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'marked_paid' CHECK (status IN ('marked_paid')),
  memo text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Entry rules (single writer: `server/ledger.ts`):**
- `sale` on sub-order → `delivered` (COD: cash collected; card: captured): gross = Σ item totals for the shop's slice (after discount allocation), commission = `round(gross × commissionRate)`, net = gross − commission. Commission rate read from settings (plan-8, default 10%).
- `refund` on sub-order refund (plan-3): gross = refunded amount, net = −(refunded net + proportional commission reversal).
- `payout` on admin mark: net_cents negative (money out), memo = payout id.

**Invariant (unit-tested):** Σ ledger.net per shop == lifetime earnings − payouts.

## Server functions (`server/ledger.ts`, `server/payouts.ts`)

| Function | Auth | Behavior |
| --- | --- | --- |
| `ledgerSale(subOrderId)` (internal, called on delivered/paid transitions) | system | One `sale` entry per sub-order at delivery/settlement; idempotent via sub_order_id+kind unique check |
| `getSellerBalance()` | seller | available (Σ net − Σ payouts), pending (delivered-not-paid card orders) |
| `getSellerStatement({ from?, to?, page })` | seller | Paginated ledger rows + running balance + totals |
| `getPayoutOverview({ shopId? })` | admin (all) / seller (own) | Balance per shop |
| `createPayout({ shopId, amountCents?, memo })` | super_admin | Defaults to available balance; validates against it; insert `payout` + `payout` ledger entry |
| `listPayouts({ shopId? })` | admin / seller(own) | Payout history |

## UI

- **Seller** `/seller/payouts`: balance cards (available / pending / lifetime) + statement table (date, kind, gross/commission/net, memo) + payout history. Nav entry "Payouts".
- **Seller dashboard**: available-balance stat card.
- **Admin** `/admin/payouts`: per-shop balances, "Mark paid" (amount prefilled, memo), payout history. Nav entry.

## Acceptance criteria

- [ ] Delivered sub-order (COD marked paid OR card captured) creates exactly one `sale` entry; re-running the transition does not duplicate.
- [ ] Commission math matches settings rate; rounding is half-up and reconciles (10% of 3500 → 350).
- [ ] Refund produces a balancing `refund` entry; shop balance decreases correctly.
- [ ] Payout cannot exceed available balance (server-enforced); payout updates the balance immediately.
- [ ] Seller sees only their own statement; admin sees all shops.
- [ ] Unit tests: sale/refund/payout entries + the reconciliation invariant across a randomized sequence.

## Explicitly not in this plan

Automatic scheduled payouts (cron), tax forms, multi-currency payouts, payment-provider payouts (Stripe Connect) — phase 4 candidates.
