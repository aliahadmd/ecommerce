# Plan 002: Let buyers retry failed card payments (and switch method) instead of dead-ending

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 72aa41e..HEAD -- apps/web/src/server/payments.ts apps/web/src/routes/checkout.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (land before plan 003, which rewrites adjacent code)
- **Category**: bug
- **Planned at**: commit `72aa41e`, 2026-09-28

## Why this matters

`startCheckoutPayment` short-circuits whenever ANY payment row exists for the
order. Only the exact combination `method='card' AND state='requires_payment'`
returns a pay URL; every other existing row returns `{ method, payUrl: "" }`.
Consequences, confirmed in code:

- A buyer whose single card attempt was marked `failed` (the fake gateway's
  "Simulate failure" button does exactly this) gets `payUrl: ""` forever —
  the order can never be paid through the product. No new intent is created.
- A buyer who created a COD row and then wants to pay by card also gets
  `payUrl: ""` — the method can never be switched.

The order then sits `pending`/`unpaid` permanently. This plan makes failed
card payments retryable and makes the COD→card switch create a card intent.

## Current state

Relevant files:

- `apps/web/src/server/payments.ts` — `startCheckoutPayment` server fn
  (lines ~14–79). Ownership is already enforced (`buyerId !== user.id` →
  FORBIDDEN). The existing-row short-circuit is lines 31–45.
- `apps/web/src/routes/pay.$ref.tsx` — the fake gateway page; posts to
  `/api/payments/callback`. It sets `state='failed'` on the "Simulate
  failure" path (callback code), which is how rows get stuck.
- `apps/web/src/routes/checkout.tsx` — `place()` calls
  `startCheckoutPayment({ data: { orderId, method } })`; on
  `payment.data.method === "card" && payment.data.payUrl` it redirects to the
  gateway page; COD shows a toast. No changes needed there, but read it to
  understand the contract: `payUrl: ""` means "nothing to redirect to".

Excerpt as it exists today (`apps/web/src/server/payments.ts:31-45`):

```ts
const [existing] = await db
  .select()
  .from(schema.payments)
  .where(eq(schema.payments.orderId, order.id))
  .limit(1)
if (existing) {
  if (existing.method === "card" && existing.providerRef && existing.state === "requires_payment") {
    const provider = paymentsPkg.getProvider()
    return {
      method: "card" as const,
      payUrl: provider.id === FAKE ? `/pay/${existing.providerRef}` : "",
    }
  }
  return { method: existing.method, payUrl: "" }
}
```

The `payments` table (`packages/db/src/schema/payments.ts`): one row per
order (unique on `order_id`), columns include `method` ('cod' | 'card'),
`state` ('requires_payment' | 'succeeded' | 'failed' |
'pending_on_delivery'), `providerRef` (unique), `provider`.

Repo conventions:

- Import drizzle only via `@ecommerce/db`; throw `new AppError("CODE", msg)`
  inside `guard(async () => ...)`; server fns return the Result envelope via
  `guard` — match the file's existing style exactly.
- The `FAKE` constant in this file is `"fake"` (the provider id of the fake
  provider from `@ecommerce/payments`).

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `pnpm typecheck`                     | exit 0              |
| Unit      | `pnpm test`                          | 20 tests pass       |
| Lint      | `pnpm lint`                          | 0 errors            |
| E2E (card) | `cd apps/web && npx playwright test --grep "card payment"` | 1 passed — needs dev env running (docker compose up -d; pnpm db:migrate && pnpm db:seed; pnpm dev; export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH") |

## Scope

**In scope** (the only files you should modify):
- `apps/web/src/server/payments.ts` — the `startCheckoutPayment` handler only

**Out of scope** (do NOT touch, even though they look related):
- `apps/web/src/routes/api/payments/callback.ts` and the in-file settle fn —
  plan 003 owns those.
- `packages/payments/**` — provider behavior stays as-is.
- The `/pay/$ref` page and checkout page.

## Git workflow

- Branch: `advisor/002-payment-retry`
- Commit style: `fix: retry failed card payments and allow COD->card switch in startCheckoutPayment`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make the existing-row branch method-aware and failure-aware

Replace the `if (existing) { ... }` block with logic that:

1. `state === "succeeded"` → return `{ method: existing.method, payUrl: "" }`
   (order already paid; nothing to do — keep as-is).
2. COD row (`existing.method === "cod"`):
   - requested `data.method === "cod"` → return `{ method: "cod", payUrl: "" }`
     (row stays; unchanged behavior).
   - requested `data.method === "card"` → fall through to intent creation
     (the code below the block), which must UPDATE the existing row to
     `method='card'`, `state='requires_payment'`, a NEW `providerRef`, and
     fresh `amountCents`/`currency` from the order — not INSERT a duplicate
     (the table is unique on `order_id`).
3. Card row with `state === "requires_payment"` and a `providerRef` → return
   the existing pay URL (unchanged behavior).
4. Card row with `state === "failed"` → create a NEW intent with a NEW ref
   and UPDATE the row (`providerRef`, `state='requires_payment'`), then
   return the new pay URL.

Structure it by letting the block fall through to shared intent-creation
code instead of early-returning `payUrl: ""`. The intent-creation code that
already exists below the block (build `ref`, call
`provider.createIntent`, insert) becomes "create or update" — use
`db.update(schema.payments).set({...}).where(eq(schema.payments.id, existing.id))`
when `existing` is present, and the current `db.insert` when it is not.
Keep `void provider` style inconsistencies out; match the file.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Guard the succeeded state explicitly

Make sure no branch can create or refresh an intent once
`existing.state === "succeeded"` — early-return before any intent logic
(this is the money-safety rail; the fake callback path is idempotent on
`succeeded`, so do not let a second intent re-open a paid order).

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Gates + manual behavior check

**Verify**: `pnpm test && pnpm lint` → 20 tests, 0 errors.
**Verify (if env available)**: `cd apps/web && npx playwright test` → 10 passed.

## Test plan

No unit-test harness exists for server fns (DB-coupled); verification is
typecheck + the existing e2e card spec (happy path must stay green).

Manual/e2e-reviewed behaviors:

- Place a card order → on the gateway page click "Simulate failure" →
  revisit `/checkout` with the same order… (note: checkout requires a cart;
  instead verify via the orders page "pay" entry point if one exists, or by
  calling the flow again in a fresh cart) — the point to confirm in review:
  a second `startCheckoutPayment` call on a failed row returns a NEW
  `payUrl`, not `""`.
- A succeeded row never returns a pay URL.

Since scripting the failure path needs UI support this plan does not add,
review of the branch logic + the existing card e2e is the acceptance bar.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0 (20 tests); `pnpm lint` 0 errors
- [ ] A `failed` card row leads to a new intent + updated row on the next
      `startCheckoutPayment` call (code-reviewed against step 1; no `payUrl: ""` fall-through for failed rows)
- [ ] A `succeeded` row can never reach the intent code (early return)
- [ ] No duplicate payments rows possible (update path used when a row exists)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpt at `payments.ts:31-45` doesn't match (drift), or
  `startCheckoutPayment` has been restructured by another plan landing first.
- The `payments` schema turns out to allow multiple rows per order (the
  update-vs-insert assumption is false).
- You find yourself needing to touch the callback route or the payments
  package to make retry safe — that is plan 003's territory.

## Maintenance notes

- Plan 003 rewrites the settle/void side and the callback route; if it lands
  first, expect merge friction in this file — rebase 002 onto it.
- If a real Stripe provider is enabled later, retry semantics must reuse the
  provider's own intent-reuse rules; the UPDATE-here approach assumes the
  fake provider's intents are stateless refs.
