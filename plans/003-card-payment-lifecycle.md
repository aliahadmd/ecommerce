# Plan 003: Card payment lifecycle — cancelling an order kills its payment, and settling can never resurrect cancelled sub-orders

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 72aa41e..HEAD -- apps/web/src/server/payments.ts apps/web/src/server/sub-orders.ts apps/web/src/routes/api/payments/callback.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches the money-settle path; the full e2e suite is the
  safety net and must pass)
- **Depends on**: plans/002-payment-retry.md (same file; land 002 first)
- **Category**: bug
- **Planned at**: commit `72aa41e`, 2026-09-28

## Why this matters

The card-payment lifecycle has a hole at both ends:

1. **Cancel does not touch card payments.** When every sub-order of an order
   is cancelled, only COD rows (`method='cod' AND
   state='pending_on_delivery'`) are voided. A `requires_payment` card row
   survives, so the `/pay/$ref` gateway page stays live for a cancelled
   order.
2. **Settling force-confirms regardless of cancellations.** The unauthenticated
   gateway callback route updates ALL of the order's sub-orders to `confirmed`
   with no status filter and hardcodes `orders.status='confirmed'` +
   `paymentStatus='paid'`. A buyer can: place a card order → cancel it (stock
   restored, order `cancelled`) → open the still-live `/pay/$ref` page → pay.
   Money is captured, cancelled sub-orders flip to `confirmed` (sellers
   fulfill a cancelled order), and the order reads confirmed/paid with no
   refund path and no ledger trail.
3. **The two settle paths have drifted.** The callback route and the
   `settleCallback`-style server fn in `payments.ts` implement the same
   transition twice with different semantics: the server fn filters
   `status='pending'` (better) but still hardcodes `orders.status='confirmed'`
   instead of deriving it; the route skips the filter AND skips
   `deriveOrderPaymentStatus`. Two copies of money logic guarantee future
   divergence.
4. `startCheckoutPayment` checks ownership but not order status, so a fresh
   intent can be created for an already-cancelled order (secondary; fixed by
   the same guard added in step 2).

## Current state

Relevant files:

- `apps/web/src/routes/api/payments/callback.ts` — unauthenticated POST
  route; HMAC-verified via `paymentsPkg.fakeProvider.verifyCallback`; then
  the settle transaction (excerpt below).
- `apps/web/src/server/payments.ts` — the server-fn twin of the settle logic
  (excerpt below), plus `startCheckoutPayment` (ownership check at
  lines 22–29, no status check) and `markCodPaid`.
- `apps/web/src/server/sub-orders.ts` — buyer/seller cancel path; the
  "every sub-order cancelled" block at ~lines 211–230 voids COD only.
- `apps/web/src/server/payouts-internals.ts` — exports
  `deriveOrderPaymentStatus(tx, orderId)` (recomputes `orders.paymentStatus`
  from the payments rows) — use it, never hardcode payment status.
- `apps/web/src/server/internals.ts` — exports
  `recomputeOrderStatus(tx, orderId)` (derives `orders.status` from
  sub-order states) — use it, never hardcode order status.

Excerpt — callback route settle transaction
(`apps/web/src/routes/api/payments/callback.ts`, after the HMAC check and
the `payment.state === "succeeded"` idempotency return):

```ts
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
      .where(eq(schema.subOrders.orderId, payment.orderId))   // ← no status filter
    await tx
      .update(schema.orders)
      .set({ paymentStatus: "paid", status: "confirmed" })    // ← hardcoded
      .where(eq(schema.orders.id, payment.orderId))
  }
})
```

Excerpt — server-fn twin (`apps/web/src/server/payments.ts`, ~lines 106–127):

```ts
if (newState === "succeeded") {
  // paid card orders skip the seller-confirm wait: mark sub-orders confirmed
  await tx
    .update(schema.subOrders)
    .set({ status: "confirmed" })
    .where(
      and(
        eq(schema.subOrders.orderId, payment.orderId),
        eq(schema.subOrders.status, "pending")                // ← filtered (differs from route)
      )
    )
  await tx
    .update(schema.orders)
    .set({ status: "confirmed" })                             // ← hardcoded
    .where(eq(schema.orders.id, payment.orderId))
  const { deriveOrderPaymentStatus } = await import("./payouts-internals")
  await deriveOrderPaymentStatus(tx, payment.orderId)
}
```

Excerpt — cancel void block (`apps/web/src/server/sub-orders.ts`, inside the
cancel transaction, after stock restore + `recomputeOrderStatus`):

```ts
if ((remaining ?? 0) === 0) {
  await tx
    .update(schema.payments)
    .set({ state: "failed" })
    .where(
      and(
        eq(schema.payments.orderId, row.sub.orderId),
        eq(schema.payments.method, "cod"),
        eq(schema.payments.state, "pending_on_delivery")
      )
    )
  const { deriveOrderPaymentStatus } = await import("./payouts-internals")
  await deriveOrderPaymentStatus(tx, row.sub.orderId)
}
```

Repo conventions: drizzle via `@ecommerce/db` only; `AppError` + `guard`;
route files under `src/routes/api/**` are plain request handlers (no guard
wrapper — the HMAC check IS the authenticator); never import
`./internals`/`./payouts-internals` from code reachable by the client bundle
— dynamic `await import(...)` inside server handlers is the established
pattern in this repo.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `pnpm typecheck`                     | exit 0              |
| Unit      | `pnpm test`                          | 20 tests pass       |
| Lint      | `pnpm lint`                          | 0 errors            |
| Full e2e  | `cd apps/web && npx playwright test` | 10 passed — needs dev env (docker compose up -d; pnpm db:migrate && pnpm db:seed; pnpm dev; export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"). The card spec exercises place→gateway→pay→paid and MUST stay green. |

## Scope

**In scope** (the only files you should modify):
- `apps/web/src/routes/api/payments/callback.ts`
- `apps/web/src/server/payments.ts`
- `apps/web/src/server/sub-orders.ts` (the cancel void block only)

**Out of scope** (do NOT touch):
- `packages/payments/**` — the fake provider's HMAC/verify stays as-is.
- The `/pay/$ref` page — it keeps calling the same endpoints.
- Refund ledger entries for captured-then-cancelled payments (parking-lot
  scope; this plan only prevents NEW capture-after-cancel).
- Buyer/seller cancel eligibility rules (who may cancel when) — unchanged.

## Git workflow

- Branch: `advisor/003-card-lifecycle`
- Commit per step; style: `fix: void card payments on full order cancellation` then `fix: single guarded settle path for payment callbacks`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Full cancellation voids/abandons card payments too

In `apps/web/src/server/sub-orders.ts`, widen the void block so that when
`remaining === 0`, card rows that have NOT succeeded are also killed:

```ts
if ((remaining ?? 0) === 0) {
  // void pending COD…
  await tx
    .update(schema.payments)
    .set({ state: "failed" })
    .where(
      and(
        eq(schema.payments.orderId, row.sub.orderId),
        eq(schema.payments.method, "cod"),
        eq(schema.payments.state, "pending_on_delivery")
      )
    )
  // …and abandon any card payment that never settled. (A succeeded capture
  // is left alone here — refunding it is ledger work, out of scope.)
  await tx
    .update(schema.payments)
    .set({ state: "failed" })
    .where(
      and(
        eq(schema.payments.orderId, row.sub.orderId),
        eq(schema.payments.method, "card"),
        eq(schema.payments.state, "requires_payment")
      )
    )
  const { deriveOrderPaymentStatus } = await import("./payouts-internals")
  await deriveOrderPaymentStatus(tx, row.sub.orderId)
}
```

(The `deriveOrderPaymentStatus` line already exists; keep exactly one.)

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: `startCheckoutPayment` refuses cancelled orders

In `apps/web/src/server/payments.ts`, in `startCheckoutPayment`, immediately
after the ownership check (`order.buyerId !== user.id`), add:

```ts
if (order.status === "cancelled") {
  throw new AppError("INVALID", "This order was cancelled")
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: One guarded settle implementation, used by both paths

The route must not hand-roll the transition. Create a small server-only
helper and call it from both places:

1. Add to `apps/web/src/server/payments.ts` (exported plain async function —
   `payments.ts` is imported by route files, and the server-fn-only-export
   rule says plain helpers belong in an internals file; therefore put it in
   `apps/web/src/server/payouts-internals.ts` instead, next to
   `deriveOrderPaymentStatus`, following that file's style):

```ts
/**
 * Settle a card payment after gateway verification. Idempotent on
 * `succeeded`. Only transitions sub-orders that are still `pending`, and
 * derives (never hardcodes) the parent order status — a cancelled or partly
 * cancelled order must never be resurrected by a late payment.
 * Returns the resulting payment state, or null if the payment is un-settleable.
 */
export async function settleCardPayment(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  paymentId: string,
  outcome: "succeeded" | "failed"
): Promise<"succeeded" | "failed" | null>
```

Behavior:
- Load the payment row FOR UPDATE (`.for("update")`) inside the tx.
- If `state === "succeeded"` → return `"succeeded"` (idempotent replay).
- Set `state` to the outcome.
- On success: `UPDATE sub_orders SET status='confirmed' WHERE order_id = ?
  AND status = 'pending'`; then recompute the parent via
  `recomputeOrderStatus(tx, orderId)` (from `./internals`) AND
  `deriveOrderPaymentStatus(tx, orderId)`.
- Guard: if the order has ZERO sub-orders with `status <> 'cancelled'`
  (fully cancelled), do NOT confirm anything — set the payment to
  `"failed"` instead and return `"failed"` (the money was not captured; the
  gateway page for a cancelled order is dead).

2. Rewrite the callback route's transaction to call
   `settleCardPayment` (dynamic `await import("@/server/payouts-internals")`
   — check how other route files under `src/routes/api/**` import server
   internals; if none do, a relative import
   `../../../../server/payouts-internals` matching the file depth is fine —
   verify the path resolves with typecheck). The route keeps: body parsing,
   HMAC verification, payment lookup, the pre-tx `succeeded` fast path can be
   REMOVED (the helper is idempotent), and returns
   `{ ok: true, state: <helper result or "failed"> }`.

3. Rewrite the server-fn settle block in `payments.ts` (the twin) to call
   the same `settleCardPayment`, deleting its inline transition.

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Gates + full e2e

**Verify**: `pnpm test && pnpm lint` → 20 tests, 0 errors.
**Verify (env required for this plan)**: `cd apps/web && npx playwright test`
→ 10 passed. The `card payment` spec must still pass — it proves the happy
path (all sub-orders pending → pay → confirmed/paid) survives the new guards.

## Test plan

No DB test harness exists; acceptance is code review against the behavior
matrix plus the full e2e suite. Behavior matrix to verify in review:

| Scenario | Expected |
| --- | --- |
| Pay succeeds, all sub-orders pending | sub-orders → confirmed; order → derived (confirmed), paymentStatus paid |
| Callback replayed (same ref, succeeded) | `{ok:true, state:"succeeded"}`, no changes |
| Order fully cancelled, then callback succeeds | payment → failed, sub-orders untouched, order stays cancelled |
| Callback with unknown ref / bad sig | 404 / 401 (unchanged) |
| COD cancel void | unchanged behavior |

If you can add a pure unit test for the "fully cancelled → failed" decision
extracted as a small pure function, do so in `apps/web/src/lib/` following
`order-machine.test.ts` as the pattern; otherwise skip — do not build a DB
harness.

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm test` 20/20; `pnpm lint` 0 errors
- [ ] `grep -n 'status: "confirmed"' apps/web/src/routes/api/payments/callback.ts` → no matches (transition moved to the shared helper)
- [ ] `grep -n 'set({ status: "confirmed" })' apps/web/src/server/payments.ts` → no matches in the settle fn (helper owns it)
- [ ] Exactly one place in the codebase performs the card settle transition (`settleCardPayment` in payouts-internals.ts)
- [ ] Full e2e suite passes (10/10)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above don't match the live code (drift or another plan landed).
- `recomputeOrderStatus` is not exported from `apps/web/src/server/internals.ts`.
- Making the route import the helper breaks the client bundle or typecheck in
  a way you cannot resolve with a relative import (import-cycle signals).
- The full e2e suite fails twice after a reasonable fix attempt.

## Maintenance notes

- Captured-then-cancelled card payments (succeeded before cancellation) are
  deliberately left as-is: refunding them needs per-line refunds + ledger
  refund entries — already on the phase-3 parking lot
  (`plans/phase3/plan-10.md`). The new full-cancel guard prevents the worst
  case (late capture on a dead order) but does not refund old captures.
- When Stripe goes live, `verifyCallback`'s outcome must feed the same
  `settleCardPayment` — the helper is the single integration point.
- Reviewer focus: the `remaining === 0` count in sub-orders and the
  `status='pending'` filter in the helper — off-by-one there either freezes
  legitimate orders or resurrects cancelled ones.
