# Plan 004: Bind cart variants to their product — checkout decrements the variant it actually charged for

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 72aa41e..HEAD -- apps/web/src/server/commerce.ts`
> If the in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (note: plans 001 and 004 both touch
  `commerce.ts` — rebase whichever lands second)
- **Category**: bug
- **Planned at**: commit `72aa41e`, 2026-09-28

## Why this matters

Nothing in the cart/checkout path verifies that a cart line's `variantId`
belongs to that line's `productId`:

- `addToCart` accepts any `variantId` value with the cart request and checks
  stock against the PRODUCT aggregate only.
- The checkout variant decrement matches `id = item.variantId AND
  status='active' AND stock >= qty` with no `productId` predicate.
- Cancellation restores stock to whatever variant id is on the line.

A crafted cart line (cheap product A + any other product's variant id)
decrements product B's variant inventory while the order is priced at A's
price — corrupting both revenue and stock for the victim product, and
charging the buyer for an item they did not get. There is no FK or CHECK
constraint tying `cart_items.variant_id` to `cart_items.product_id`
(`packages/db/src/schema/commerce.ts`, `cart_items` definition).

## Current state

Relevant file: `apps/web/src/server/commerce.ts` (all three sites below).

`addToCart` — product fetch + stock check + insert (~lines 96–147):

```ts
const [product] = await db
  .select({ ..., stock: schema.products.stock, /* shopStatus, title, etc. */ })
  .from(schema.products)
  .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
  .where(eq(schema.products.id, data.productId))
  .limit(1)
if (!product || product.status !== "active" || product.shopStatus !== "active") {
  throw new AppError("NOT_FOUND", "This product is not available")
}
const cart = await ensureCart(user.id)
// ...existing-row merge, then:
if (requested > product.stock) {
  throw new AppError("OUT_OF_STOCK", `Only ${product.stock} left of "${product.title}"`)
}
// ...
await db.insert(schema.cartItems).values({
  cartId: cart.id,
  productId: product.id,
  variantId: data.variantId,   // ← accepted verbatim, never validated
  quantity: data.quantity,
})
```

`placeOrder` variant decrement (~lines 447–465, inside the transaction):

```ts
for (const item of items) {
  if (item.variantId) {
    // Variant-level decrement (same row-level oversell guard)
    const updated = await tx
      .update(schema.productVariants)
      .set({ stock: sql`${schema.productVariants.stock} - ${item.quantity}` })
      .where(
        and(
          eq(schema.productVariants.id, item.variantId),
          eq(schema.productVariants.status, "active"),
          gte(schema.productVariants.stock, item.quantity)
        )
      )
      .returning({ id: schema.productVariants.id })
    if (updated.length === 0) { /* throw OUT_OF_STOCK */ }
```

Cancellation restore in `apps/web/src/server/sub-orders.ts` (~lines
186–202, inside the cancel transaction) mirrors the decrement with
`sql\`stock + quantity\`` and the same predicate minus the stock floor.

Schema facts (`packages/db/src/schema/commerce.ts`):
- `product_variants` has `productId` (FK to products), `status`
  ('active'|…), `stock`, `priceCents`.
- The variant-aware UI (`variant-selector.tsx`) always sends valid pairs —
  this plan closes the server-side hole for crafted requests.

Repo conventions: drizzle via `@ecommerce/db` only; `AppError` codes
"NOT_FOUND" / "INVALID" / "OUT_OF_STOCK"; throw inside `guard`/
transactions; commit style lowercase imperative.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `pnpm typecheck`                     | exit 0              |
| Unit      | `pnpm test`                          | 20 tests pass       |
| Lint      | `pnpm lint`                          | 0 errors            |
| E2E (variant + checkout) | `cd apps/web && npx playwright test --grep "variant|order: buyer checkout|card payment"` | 3 passed — needs dev env (docker compose up -d; pnpm db:migrate && pnpm db:seed; pnpm dev; export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH") |

## Scope

**In scope** (the only files you should modify):
- `apps/web/src/server/commerce.ts` — `addToCart`, `updateCartItem`, and the
  `placeOrder` decrement predicate
- `apps/web/src/server/sub-orders.ts` — the cancel-restore predicate only

**Out of scope** (do NOT touch):
- Schema/migrations (no new constraints in this plan — see Maintenance notes)
- `apps/web/src/components/variant-selector.tsx` and any client code
- The product-aggregate stock check in `addToCart` (kept; see steps)

## Git workflow

- Branch: `advisor/004-variant-binding`
- Commit style: `fix: bind cart variant to product — validate at add-time, decrement with product predicate`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Validate the variant at add-time (`addToCart`)

In `addToCart`, when `data.variantId` is present, load the variant and
verify it belongs to the product, is active, and has stock — BEFORE the
existing-row merge:

```ts
let variant: { id: string; priceCents: number; stock: number } | null = null
if (data.variantId) {
  const [v] = await db
    .select({
      id: schema.productVariants.id,
      productId: schema.productVariants.productId,
      status: schema.productVariants.status,
      stock: schema.productVariants.stock,
    })
    .from(schema.productVariants)
    .where(eq(schema.productVariants.id, data.variantId))
    .limit(1)
  if (!v || v.productId !== product.id || v.status !== "active") {
    throw new AppError("INVALID", "That variant is not available")
  }
  if (v.stock < data.quantity) {
    throw new AppError("OUT_OF_STOCK", `Only ${v.stock} left of "${product.title}"`)
  }
  variant = v
}
```

Then use `variant` in place of the product aggregate for the requested-
quantity stock comparison when a variant is present (variant stock is the
real constraint; the product aggregate check can stay for the no-variant
path). Do not change the merge/update math otherwise.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Same validation in `updateCartItem`

`updateCartItem` (same file) accepts a new `quantity` (and possibly no
variant change — read it first). Apply the same variant-stock check when the
line has a `variantId`: load the cart item's variantId, then check
`variant.stock >= newQuantity`. If `updateCartItem` never changes
`variantId`, only the stock check is needed there.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Product-bind the checkout decrement

In the `placeOrder` variant decrement, add the product predicate so a
crafted line can never touch another product's variant:

```ts
.and(eq(schema.productVariants.productId, item.productId))
```

(`item.productId` is on the cart-line rows the loop iterates — confirm the
field name on the `items` select above the loop; adapt if it is named
differently.)

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Product-bind the cancel restore

In `apps/web/src/server/sub-orders.ts`, add the same
`eq(schema.productVariants.productId, item.productId)` predicate to the
restore UPDATE so stock returns to the correct product's variant even for
historical crafted lines.

**Verify**: `pnpm typecheck` → exit 0.

### Step 5: Gates + e2e

**Verify**: `pnpm test && pnpm lint` → 20 tests, 0 errors.
**Verify (env available)**: the three targeted e2e specs → 3 passed
(variant selection/checkout specs exercise the changed paths end-to-end).

## Test plan

No new automated tests (DB-coupled paths; no harness — same policy as plans
001–003). Review checklist:

- `addToCart` with a variantId from a DIFFERENT product → INVALID error.
- `addToCart` with an inactive or out-of-stock variant → OUT_OF_STOCK/INVALID.
- Normal variant purchase (e2e `variant` spec) still decrements and restores
  the right variant (e2e covers add + cancel paths via the order specs).

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm test` 20/20; `pnpm lint` 0 errors
- [ ] `grep -n "productId, item.productId" apps/web/src/server/commerce.ts apps/web/src/server/sub-orders.ts` → ≥2 matches (decrement + restore)
- [ ] `addToCart` contains a variant-product validation before insert
- [ ] Targeted e2e specs pass (3/3)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts don't match (drift), or the `items` rows in the placeOrder
  loop carry no `productId` (field named differently AND absent — report the
  actual shape instead of guessing).
- `updateCartItem` turns out to accept a NEW `variantId` (report; the plan
  assumed quantity-only).
- The variant spec fails twice after a reasonable fix attempt.

## Maintenance notes

- The DB-level backstop (composite FK or CHECK on `cart_items`) is deferred —
  a migration that validates existing rows first; revisit when migrations are
  next touched.
- `order_items` store `variantId` too; the same binding is implicitly
  enforced at order creation by step 3 — no change needed on order items.
- Reviewer focus: the merge math in `addToCart` (existing row + quantity)
  must compare against VARIANT stock, not product stock, once a variant is
  bound — that is the subtle part of step 1.
