# Plan 006: Payment endpoints — sellers can only settle their own orders, buyers can only sign their own payments

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 72aa41e..HEAD -- apps/web/src/server/payments.ts`
> If the in-scope file changed since this plan was written (plan 002 or 003
> may have landed), compare the "Current state" excerpts against the live
> code; adapt the line positions but NOT the semantics, and treat any
> semantic mismatch as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/003-card-payment-lifecycle.md (same file; land 003 first)
- **Category**: security
- **Planned at**: commit `72aa41e`, 2026-09-28

## Why this matters

Two payment endpoints skip authorization on the object they act on:

1. **`markCodPaid`** requires only the seller ROLE, then updates the payment
   and order rows for ANY `orderId` the caller supplies. Any seller account
   can settle (or prematurely mark paid) the COD payment of ANY order in the
   marketplace — including other sellers' orders and undelivered ones —
   corrupting payment status, payout derivation, and downstream ledger
   entries across tenants.
2. **`signCallback`** requires only a logged-in user, then mints a valid
   settlement signature for ANY payment `ref` the caller supplies. Refs
   embed the order number (`PAY-<orderNumber>-<timestamp>`), so any buyer
   who learns another order's ref can sign and submit its settlement
   themselves — confirming sub-orders and marking someone else's order paid.

The fix is the standard ownership pattern this codebase already uses
everywhere else (see `getOrderDetail` in `commerce.ts` for the exemplar).

## Current state

Relevant file: `apps/web/src/server/payments.ts`.

`signCallback` (excerpt):

```ts
.handler(({ data }) =>
  guard(async () => {
    await requireUser()
    return { sig: signFakeCallback(data.ref, data.outcome) }
  }),
)
```

`markCodPaid` (excerpt):

```ts
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
    await db.transaction(async (tx) => {
      await tx
        .update(schema.orders)
        .set({ paymentStatus: "paid" })
        .where(eq(schema.orders.id, data.orderId))
      const { deriveOrderPaymentStatus } = await import("./payouts-internals")
      await deriveOrderPaymentStatus(tx, data.orderId)
    })
    return { ok: true }
  }),
)
```

Existing patterns to reuse:

- **Seller tenancy**: `apps/web/src/server/sub-orders.ts` (`updateSubOrderStatus`)
  resolves the caller's shop via
  `db.select({ id: schema.shops.id }).from(schema.shops).where(eq(schema.shops.ownerId, user.id))`
  and compares against the row's `shopId`. `sub_orders` rows carry
  `orderId` + `shopId`.
- **Buyer ownership**: `startCheckoutPayment` in the same file already does
  `const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, ...))`
  + `if (order.buyerId !== user.id) throw new AppError("FORBIDDEN", ...)`.
- `AppError("FORBIDDEN", ...)` / `AppError("NOT_FOUND", ...)` inside
  `guard` — match exactly.
- `requireRole`, `requireUser` from `./session`.

Schema facts: `payments.providerRef` (unique) identifies a payment by ref;
`payments.orderId` FK to orders; `orders.buyerId`; `sub_orders.shopId` +
`sub_orders.orderId`; `shops.ownerId`.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `pnpm typecheck`                     | exit 0              |
| Unit      | `pnpm test`                          | 20 tests pass       |
| Lint      | `pnpm lint`                          | 0 errors            |
| Full e2e  | `cd apps/web && npx playwright test` | 10 passed — needs dev env (docker compose up -d; pnpm db:migrate && pnpm db:seed; pnpm dev; export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"). The card spec signs+settles as the ORDER'S OWN buyer, so it must stay green. |

## Scope

**In scope** (the only files you should modify):
- `apps/web/src/server/payments.ts` — `signCallback` and `markCodPaid` only

**Out of scope** (do NOT touch):
- `apps/web/src/routes/api/payments/callback.ts` — the HMAC check is the
  authenticator there; with `signCallback` scoped, refs are only signable by
  their own buyer.
- `packages/payments/**`, the `/pay/$ref` page, checkout page.
- The order-eligibility rules for COD settlement (e.g. requiring the
  sub-order be `delivered` first) — this plan adds TENANCY, not workflow
  changes.

## Git workflow

- Branch: `advisor/006-payment-authz`
- Commit style: `fix: scope signCallback to the order's buyer and markCodPaid to the seller's own sub-orders`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `signCallback` — buyer (or admin) of the referenced payment only

Replace `await requireUser()` with a lookup + ownership check:

```ts
const user = await requireUser()
const [payment] = await db
  .select({ orderId: schema.payments.orderId })
  .from(schema.payments)
  .where(eq(schema.payments.providerRef, data.ref))
  .limit(1)
if (!payment) throw new AppError("NOT_FOUND", "Payment not found")
const [order] = await db
  .select({ buyerId: schema.orders.buyerId })
  .from(schema.orders)
  .where(eq(schema.orders.id, payment.orderId))
  .limit(1)
if (!order) throw new AppError("NOT_FOUND", "Payment not found")
if (order.buyerId !== user.id && user.role !== "super_admin") {
  throw new AppError("FORBIDDEN", "Not your payment")
}
return { sig: signFakeCallback(data.ref, data.outcome) }
```

(`user.role` is available on the session user — confirm the field name from
how `requireRole` uses it in this file/session module.)

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: `markCodPaid` — super_admin, or seller with a sub-order on that order

After `requireRole("seller", "super_admin")`, add tenancy enforcement:

```ts
const user = await requireUser() // or read the user returned by requireRole, match the session API
if (user.role !== "super_admin") {
  const [shop] = await db
    .select({ id: schema.shops.id })
    .from(schema.shops)
    .where(eq(schema.shops.ownerId, user.id))
    .limit(1)
  if (!shop) throw new AppError("FORBIDDEN", "No shop found for this account")
  const [{ own }] = await db
    .select({ own: sql<number>`count(*)::int` })
    .from(schema.subOrders)
    .where(
      and(
        eq(schema.subOrders.orderId, data.orderId),
        eq(schema.subOrders.shopId, shop.id)
      )
    )
  if ((own ?? 0) === 0) {
    throw new AppError("FORBIDDEN", "This order has no sub-order from your shop")
  }
}
```

Note: `requireRole` may already return the user — check its signature in
`apps/web/src/server/session.ts` and reuse it instead of a second
`requireUser()` call.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Gates + full e2e

**Verify**: `pnpm test && pnpm lint` → 20 tests, 0 errors.
**Verify (env required)**: full e2e suite → 10 passed. The `card payment`
spec performs sign+settle as the order's own buyer — it must stay green. If
the COD/fulfillment specs call `markCodPaid` from the seller UI, they prove
the tenancy check passes for legitimate own-shop settlements.

## Test plan

No automated tests (DB-coupled; no harness). Review checklist:

- Buyer A signing buyer B's payment ref → FORBIDDEN.
- Seller (no shop, or shop not on the order) calling `markCodPaid` → FORBIDDEN.
- Seller whose shop HAS a sub-order on the order → allowed (fulfillment e2e
  covers this if the seller UI uses it).
- `super_admin` → allowed for both.

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm test` 20/20; `pnpm lint` 0 errors
- [ ] `signCallback` contains a payment-by-ref lookup + buyer check before `signFakeCallback`
- [ ] `markCodPaid` contains the shop-tenancy check before any UPDATE
- [ ] Full e2e suite passes (10/10)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts don't match semantically (plans 002/003 landed and moved
  things — adapt positions only if semantics hold; otherwise STOP).
- `requireRole`/`requireUser` do not expose `user.role` in a way the checks
  above can use (report the actual session shape).
- The card-payment e2e spec fails because it signs as a non-buyer (that
  would mean the spec itself violates ownership — report instead of
  weakening the check).

## Maintenance notes

- If the pay page is ever linked from emails to non-buyer parties (e.g.
  guest checkout), the ownership rule here must be revisited deliberately.
- When Stripe goes live, webhook authenticity comes from Stripe (signed
  webhooks); `signCallback` remains fake-gateway-only — consider deleting it
  and the pay page then (parking lot note).
- Reviewer focus: the tenancy `count` in step 2 must filter BOTH `orderId`
  and `shopId` — a copy-paste dropping one predicate silently re-opens the
  hole.
