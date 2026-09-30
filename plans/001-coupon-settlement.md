# Plan 001: Coupon settlement — clear the cart coupon, make the in-tx limit checks real, delete the dead path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 72aa41e..HEAD -- apps/web/src/server/commerce.ts apps/web/src/server/coupons-internals.ts apps/web/src/server/coupons.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `72aa41e`, 2026-09-28

## Why this matters

Three defects in the coupon settlement path of checkout combine into real
buyer-facing failures:

1. `placeOrder` never clears `carts.coupon_id` after settling it. Since
   coupons default to `max_uses_per_user = 1`, the buyer's **next** checkout
   fails with "You already used this coupon" even though they never applied a
   coupon to the new cart — a dead end at the worst moment.
2. The in-transaction per-user limit check runs its `count(*)` **before**
   acquiring the coupon row lock, so two concurrent checkouts both count
   `mine = 0` and both redeem — exceeding `maxUsesPerUser`. The comment in the
   code claims the lock makes the count "exact"; it does not, because the
   count already executed. The global `maxUses` cap is selected but never
   checked in-transaction at all.
3. A complete parallel settlement implementation
   (`settleCoupon` in `coupons-internals.ts`) exists but has zero callers, and
   `placeOrder` contains a dead import-and-discard statement
   (`await import("@ecommerce/jobs"); void enqueueEmail`) — leftovers from a
   refactor that was half-landed. Dead parallel money code is a trap for the
   next editor.

## Current state

Relevant files:

- `apps/web/src/server/commerce.ts` — checkout transaction (`placeOrder`);
  cart clear + coupon settlement block at lines 606–645; dead import at
  642–643.
- `apps/web/src/server/coupons-internals.ts` — server-only coupon helpers;
  exports `settleCoupon` (lines ~165–199) which nobody calls.
- `apps/web/src/server/coupons.ts` — buyer/admin coupon server functions
  (imports `coupons-internals` dynamically inside handlers). Not modified by
  this plan except: nothing — out of scope.

Excerpts as they exist today (`apps/web/src/server/commerce.ts`):

```ts
// lines 606-645, inside the placeOrder db.transaction
await tx
  .delete(schema.cartItems)
  .where(eq(schema.cartItems.cartId, cart.id))
if (couponId) {
  // per-user limit enforced inside the tx (race-safe with the unique
  // per-user constraints of the flow)
  const [{ mine }] = await tx
    .select({ mine: sql<number>`count(*)::int` })
    .from(schema.couponRedemptions)
    .where(
      and(
        eq(schema.couponRedemptions.couponId, couponId),
        eq(schema.couponRedemptions.userId, user.id)
      )
    )
  // lock the coupon row: concurrent checkouts serialize here, so the
  // count checks below are exact (plan-4 race fix)
  const [coupon] = await tx
    .select({ maxUsesPerUser: schema.coupons.maxUsesPerUser, maxUses: schema.coupons.maxUses })
    .from(schema.coupons)
    .where(eq(schema.coupons.id, couponId))
    .for("update")
  if (!coupon || mine >= coupon.maxUsesPerUser) {
    throw new AppError("INVALID", "You already used this coupon")
  }
  await tx.insert(schema.couponRedemptions).values({
    couponId,
    userId: user.id,
    orderId: order.id,
    amountCents: discountCents,
  })
}
// keep product price/stock aggregates honest after variant stock moves
for (const pid of variantProductIds) {
  await recomputeProductAggregates(tx, pid)
}
const { enqueueEmail } = await import("@ecommerce/jobs")
void enqueueEmail
return order
```

Note: `cart` (with `cart.id`) is in scope in this block; the variable
`couponId` holds the cart's pending coupon id (nullable). The `carts` table
has a `couponId` column (`packages/db/src/schema/coupons.ts` —
`carts.coupon_id`, FK to coupons).

`settleCoupon` in `apps/web/src/server/coupons-internals.ts` starts with:

```ts
export async function settleCoupon(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ...
```

`grep -rn "settleCoupon" apps/web/src` matches only its definition and
doc-comment — zero callers.

Repo conventions you must follow:

- Drizzle helpers are imported only from `@ecommerce/db`
  (`import { db, schema, and, eq, sql } from "@ecommerce/db"`). Never import
  `drizzle-orm` directly (breaks resolution — TS2307).
- Expected errors are thrown as `new AppError("CODE", "message")` inside
  `guard(async () => ...)`; see `apps/web/src/server/session.ts` for the
  wrapper and any server module for usage exemplars.
- Commit style (from `git log`): lowercase imperative, e.g.
  `critical fix: stamp sub_order_id at items insert (update-before-insert left NULL); backfill legacy NULL rows`.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `pnpm typecheck`                     | exit 0              |
| Unit      | `pnpm test`                          | 2 files, 20 tests pass |
| Lint      | `pnpm lint`                          | 0 errors (1 pre-existing warning in vendored chart.tsx is OK) |
| E2E (coupon) | `cd apps/web && npx playwright test --grep "coupon"` | 1 passed — REQUIRES the dev environment running (see below) |

E2E environment (only needed for the final e2e step; skip if not available
and say so in your report): `docker compose up -d`, then `pnpm db:migrate &&
pnpm db:seed`, then `pnpm dev` (serves on :3000, wait for
`curl -s http://localhost:3000/api/health` to return 200). Node 24 via nvm:
`export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`.

## Scope

**In scope** (the only files you should modify):
- `apps/web/src/server/commerce.ts` — the settlement block + dead import only
- `apps/web/src/server/coupons-internals.ts` — delete `settleCoupon` only

**Out of scope** (do NOT touch, even though they look related):
- `apps/web/src/server/coupons.ts` — the buyer `applyCoupon`/`removeCoupon`
  fns are correct as-is.
- `validateCouponForCheckout` / `validateUsable` / `computeDiscountCents` in
  `coupons-internals.ts` — pre-transaction validation stays where it is; this
  plan only fixes the in-transaction enforcement.
- Any schema/migration change — the unique-index backstop is deliberately
  deferred (see Maintenance notes).
- The discount allocation logic (largest-remainder across sub-orders) — it is
  correct.

## Git workflow

- Branch: `advisor/001-coupon-settlement`
- One or two commits, style: `fix: clear carts.coupon_id at checkout; enforce coupon limits after row lock; drop dead settleCoupon`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Enforce the limits after acquiring the lock

In `apps/web/src/server/commerce.ts`, restructure the `if (couponId)` block so
that BOTH count queries run after the `.for("update")` lock, and the global
`maxUses` cap is checked. Target shape (keep the surrounding code identical):

```ts
if (couponId) {
  // lock the coupon row first: concurrent checkouts serialize here, so the
  // count checks below are exact
  const [coupon] = await tx
    .select({ maxUses: schema.coupons.maxUses })
    .from(schema.coupons)
    .where(eq(schema.coupons.id, couponId))
    .for("update")
  const [{ mine }] = await tx
    .select({ mine: sql<number>`count(*)::int` })
    .from(schema.couponRedemptions)
    .where(
      and(
        eq(schema.couponRedemptions.couponId, couponId),
        eq(schema.couponRedemptions.userId, user.id)
      )
    )
  const [{ total }] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.couponRedemptions)
    .where(eq(schema.couponRedemptions.couponId, couponId))
  if (
    !coupon ||
    mine >= coupon.maxUsesPerUser ||
    (coupon.maxUses !== null && total >= coupon.maxUses)
  ) {
    throw new AppError("INVALID", "You already used this coupon")
  }
  await tx.insert(schema.couponRedemptions).values({
    couponId,
    userId: user.id,
    orderId: order.id,
    amountCents: discountCents,
  })
}
```

(You will need `maxUsesPerUser` on the locked select too — select
`{ maxUses: schema.coupons.maxUses, maxUsesPerUser: schema.coupons.maxUsesPerUser }`.)
Update the stale comment above the block (the one claiming the count is
"race-safe with the unique per-user constraints") — it is wrong; the new
comment is the one shown above.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Clear the cart's coupon in the same transaction

Immediately after the `tx.delete(schema.cartItems)` call, add:

```ts
// the coupon is settled (or was invalid — either way it must not ride
// along on the buyer's next cart)
await tx
  .update(schema.carts)
  .set({ couponId: null })
  .where(eq(schema.carts.id, cart.id))
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Remove the dead import-and-discard

Delete these two lines from the same transaction (they import and immediately
discard; the real enqueue happens post-commit around line 666):

```ts
const { enqueueEmail } = await import("@ecommerce/jobs")
void enqueueEmail
```

**Verify**: `grep -n "void enqueueEmail" apps/web/src/server/commerce.ts` →
exactly ONE match (the legitimate post-commit `void enqueueEmail({...})` call),
and it is followed by `({` on the same or next line.

### Step 4: Delete the dead `settleCoupon`

Remove the entire `settleCoupon` function from
`apps/web/src/server/coupons-internals.ts` (the block starting with the
`/** Settlement (called inside the placeOrder transaction). */` comment
through its closing brace). If its JSDoc/section comment becomes orphaned,
remove that too. Do NOT remove `validateCouponForCheckout`,
`validateUsable`, `findCouponByCode`, `cartContext`, or
`computeDiscountCents` — they are used.

**Verify**: `pnpm typecheck` → exit 0, AND
`grep -rn "settleCoupon" apps/web/src` → no matches.

### Step 5: Gates

**Verify**: `pnpm typecheck && pnpm test && pnpm lint` → typecheck exit 0;
20 unit tests pass; lint 0 errors.
**Verify (if env available)**: `cd apps/web && npx playwright test` →
10 passed (the coupon spec proves apply-still-works; the two checkout specs
prove checkout still completes).

## Test plan

No new automated tests in this plan (the settlement block is
transaction-coupled; a DB harness is out of scope here). Verification is the
existing unit suite + full e2e suite. The behavioral assertions to check by
hand or in review:

- After a checkout with a coupon applied, `select coupon_id from carts where
  user_id = ...` is NULL (previously kept the old coupon id).
- `maxUsesPerUser = 2` coupon can be used exactly twice by one user.

If you want a regression test, add a pure unit test only if you can do so
without a DB harness — otherwise skip; do not improvise a test database.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0 (20 tests)
- [ ] `pnpm lint` exits 0 (0 errors)
- [ ] `grep -rn "settleCoupon" apps/web/src` → no matches
- [ ] `grep -n "void enqueueEmail" apps/web/src/server/commerce.ts` → 1 match, the post-commit one
- [ ] `grep -n "couponId: null" apps/web/src/server/commerce.ts` → ≥1 match inside placeOrder
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `commerce.ts:606-645` doesn't match the excerpts (drift).
- `schema.carts` has no `couponId` column (assumption false).
- Removing `settleCoupon` breaks typecheck — something imports it that the
  audit's grep missed.

## Maintenance notes

- The real long-term backstop for the redemption race is a DB constraint
  (e.g. a partial unique index). Deferred: with the lock now acquired before
  both counts, the remaining race window is closed for the serialized
  checkout path; revisit if checkout ever splits out of one transaction.
- `deriveOrderPaymentStatus`/`recomputeProductAggregates` calls around this
  block are unrelated — a reviewer should scrutinize only the settlement
  block and the cart clear ordering (cart clear BEFORE coupon block is fine;
  the coupon block throws after the cart was already cleared, which is
  correct: an invalid coupon must not block cart cleanup).
