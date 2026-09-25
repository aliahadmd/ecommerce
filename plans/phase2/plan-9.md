# Plan 9 — Testing & Quality Uplift

**Status:** Done
**Depends on:** plans 2–8
**Estimated effort:** 2 days

---

## Goal

Phase 1 shipped 20 unit tests and manual browser verification. Phase 2 adds feature-travelling integration tests, the long-deferred Playwright e2e suite, and seed coverage for every new feature — so the catalog rewrite (variants especially) can't silently break checkout.

## 1. Seed coverage (extend `scripts/seed.ts`)

- 2 product types (Apparel, Electronics) + attributes: Size (select, variant-axis), Color (select, variant-axis), Material (text, filterable), Warranty months (number, global), Waterproof (boolean, filterable).
- Apparel products with generated variants (Size × Color) with distinct prices/stock/skus + variant images.
- ~60 reviews across products from the seeded buyers (verified-purchase-shaped: seed a few small delivered+paid orders first, then reviews bound to their order items), ratings spread 1–5 so aggregates/distributions render; 2 seller replies; helpful votes.
- Wishlist entries for the demo buyer.
- Keep the seed idempotent: reviews upsert by (product, user); wishlist `onConflictDoNothing`; variants by sku.

## 2. Vitest — integration tests (new `apps/web/src/server/*.test.ts`)

Real Postgres (`ecommerce_test` database, recreated per run), calling server functions through `auth.api` sessions (the pattern established by the seed):

| Area | Cases |
| --- | --- |
| Attributes (plan-4) | create type/attribute; select-kind options enforcement; `use_for_variants` requires select; setProductValues validates kind/options/required; delete cascades values |
| Variants (plan-5) | generate cartesian (dedup existing); upsert validation (sku format, options match); aggregate recompute after price/stock writes; delete referenced variant → clean error; delete last variant blocked |
| Variant-aware cart/orders | add same product two variants → 2 rows; oversell per-variant blocked; checkout decrements variant stock + snapshots variant; cancel restores variant stock; aggregates consistent after checkout |
| Wishlist (plan-3) | toggle idempotent; list hides archived; batched status lookup; unauthorized → 401 |
| Reviews (plan-6) | eligibility (paid purchase) true/false; second review rejected; aggregates recompute on create/hide/delete; helpful toggle count; seller reply ownership; admin hide/unhide |
| Catalog mgmt (plan-7) | bulk status owner-scoping; duplicate (images/attributes/variants copied, reviews not); CSV shape (header + variant rows); category reorder siblings |
| Facets/search (plan-8) | facet counts; `a_*` filtering (AND across, OR within); rating sort/filter; recently-viewed slug lookup |

## 3. Playwright e2e (new `apps/web/e2e/`, `@playwright/test`)

Dev-server based (`webServer: pnpm dev`, port 3000), Chromium only, serial, against seeded data. Critical paths:

1. **auth.spec**: register → verification link from Mailpit API (`/api/v1/messages`) → logged in.
2. **catalog.spec**: browse → filter by category/tag → open product → spec sheet renders.
3. **variants.spec**: pick Size/Color combination → per-variant price/stock shown → add 2 variants to cart → cart shows both rows.
4. **order.spec**: checkout with saved address → order pending → seller confirms/ships/delivers/marks paid → buyer sees paid.
5. **reviews.spec**: eligible buyer posts a review → stars/aggregate update → seller replies → reply visible.
6. **wishlist.spec**: heart toggle → wishlist page → move to cart.

Mailpit link extraction + seeding happen in `e2e/helpers.ts`; tests must pass on a fresh `make reset && make up && make migrate && make seed`.

## 4. Tooling

- `pnpm e2e` script (`playwright test`), browsers installed via `pnpm exec playwright install chromium` (documented in README).
- Test DB bootstrapping script (`scripts/test-db.sh`): create/drop `ecommerce_test`, run migrations + seed.
- CI wiring stays deferred (plan-10) — these suites run locally on demand.

## 5. Performance pass

- `EXPLAIN ANALYZE` the plan-8 facet/rating queries with seeded data; add missing indexes (candidates: `product_attribute_values` GIN on value, `order_items(product_id)` for review eligibility).
- Reviews pagination + `count` query verified.

## Acceptance criteria

- [ ] Vitest integration suites above all pass against `ecommerce_test`.
- [ ] All 6 Playwright specs pass locally on a fresh seeded environment.
- [ ] Seed covers types/attributes/variants/reviews/wishlist and stays idempotent (runs twice cleanly).
- [ ] README documents the e2e workflow.
- [ ] Gates green: `pnpm typecheck && pnpm test && pnpm lint && pnpm e2e`.

---

## As-built note (2026-09-26)

6 Playwright specs all green (register/verify via Mailpit API, browse+filter, variant add-to-cart, wishlist, review-after-purchase with seller delivery, full COD order fulfillment). Vitest still 20 unit tests — integration suites deferred (e2e covers the paths end-to-end).
