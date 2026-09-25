# Plan 1 — Phase 2 Overview & Architecture

**Status:** Done
**Depends on:** Phase 1 complete (all plans Done, audit fixes applied)
**Date:** 2026-09-25

---

## 1. Phase 2 goals

Deepen the product domain — the marketplace's core — in six areas:

1. **Richer product details** — brand, condition, summary, weight/dimensions, SEO fields, better image management, related products.
2. **Saved / favorite products** — a wishlist with heart toggles and a dedicated page.
3. **Improved product & catalog management** — bulk operations, duplication, CSV export, low-stock thresholds, category reordering.
4. **Reviews & ratings** — verified-purchase reviews, moderation, seller replies, helpfulness votes, rating aggregates on the storefront.
5. **Product types, attributes & variants** — the structural centerpiece: typed attributes per product type, and sellable variants (per-SKU price/stock/options/images).
6. **Quality uplift** — integration tests for all new server functions, the long-deferred Playwright e2e suite, and seed data exercising every new feature.

Out of scope (parked for phase 3): online payments, per-seller sub-orders, coupons, Playwright *CI* wiring, CSV import, back-in-stock notifications, i18n. See plan-10 for the full stretch list.

---

## 2. Architecture principles carried forward

- **Additive migrations only.** Every schema change is a new migration; destructive drops only on transient tables. Data backfills (e.g. default variants) live inside migrations so a fresh clone converges to the same state.
- **Money stays integer cents; invariants move into the DB.** Phase 1 added CHECK constraints; phase 2 extends them to new columns (`variants.price_cents >= 0`, `reviews.rating between 1 and 5`, …).
- **Server functions remain the only API**: every mutation is zod-validated, session/role-checked server-side, and returns the `Result` envelope. New code reuses `guard`/`requireUser`/`requireRole`.
- **Denormalize deliberately, maintain transactionally.** `products.rating_avg/rating_count` and `review.helpful_count` are updated inside the same transaction as the writes that change them, plus an admin recompute tool as a safety net.
- **Client state stays tiny** (TanStack Store for wishlist/theme-adjacent UI); data flows through TanStack Query with the established `unwrap` pattern.

---

## 3. The variants design (the one big architectural decision)

Phase 1 products are single-SKU (`products.price_cents`, `products.stock`). Phase 2 introduces variants **without a breaking rewrite**:

```
product_types            attribute_definitions         product_variants
  id, name, slug    ───▶   id, type_id (nullable =       id, product_id, sku (uniq),
                          global attribute),             title, price_cents, stock,
                          name, slug, kind (text|number| weight_grams, image_id,
                          boolean|select|multiselect),   is_default, status, position
                          options jsonb, unit, required,
                          filterable, position           variant_option_values
                                                         variant_id, attribute_id, value
product_attribute_values
  product_id, attribute_id, value jsonb   (spec-sheet values, not variant axes)
```

**Decision — where price/stock live:** on `product_variants`. `products.price_cents/stock` remain as columns but become **derived aggregates** (min price across active variants; summed stock), recomputed inside the same transaction as every variant write. Rationale: avoids rewriting phase-1 reads (cards, emails, order snapshots) while making variants the single source of truth. Products *without* variants keep using the product-level columns directly — both shapes coexist.

**Decision — cart/order compatibility:** `cart_items.variant_id` and `order_items.variant_id` are added **nullable**, with a migration that backfills a *default variant* for every existing product (copying price/stock/primary image). Add-to-cart then always targets a variant; `null` remains only as a legacy fallback and is treated as "the product's default variant" in reads.

**Decision — option axes vs spec values:** attributes flagged as variant axes (`use_for_variants: boolean`) drive option selectors and variant generation (cartesian product with per-combination price/stock); plain attributes render as the spec sheet and can feed storefront filters (`filterable: boolean`).

---

## 4. Reviews design in brief

- One review per user per product (`unique(product_id, user_id)`), rating `1..5` (CHECK), title + body.
- **Verified purchase** = the user has an order containing that product with `payment_status = 'paid'` (or delivered) — badge, not a gate (anyone who bought can review; others cannot — phase 2 keeps reviews purchase-only, the simplest honest model).
- Moderation: reviews start `approved` (low-friction MVP) with admin hide/reject; seller reply (one per review); helpful votes with `unique(review_id, user_id)` and a maintained `helpful_count`.
- Aggregates: `products.rating_avg (numeric(3,2))`, `products.rating_count (int)` maintained transactionally on approve/hide/delete.

---

## 5. Plan index (execution order)

| Plan | Title | Depends on |
| --- | --- | --- |
| plan-1 | Overview & architecture (this file) | — |
| plan-2 | Richer product details & image management | — |
| plan-3 | Wishlist (saved products) | — |
| plan-4 | Product types & attributes | — |
| plan-5 | Variants | plan-4 |
| plan-6 | Reviews & ratings | plan-2 (product page layout) |
| plan-7 | Catalog management enhancements | plan-2, plan-5 |
| plan-8 | Storefront enhancements (recently viewed, facets, rating sort) | plan-3, plan-5, plan-6 |
| plan-9 | Testing & quality uplift (integration + Playwright e2e + seeds) | all above |
| plan-10 | Stretch & deferred (parking lot) | — |

Plans 2, 3, 4 are mutually independent and can run in parallel; 5 needs 4; 6 needs 2; 7 needs 2+5; 8 needs 3+5+6; 9 last.

---

## 6. Best practices adopted

1. **Schema-first, additive, backfilled** — no destructive migration; default-variant backfill keeps every existing product purchasable.
2. **Invariants in the database** — CHECK constraints on every new numeric/enum-ish column, unique constraints for "one review per user", wishlist pairs, option values.
3. **Server-side everything** — authorization, validation, aggregate maintenance; the client never writes derived fields.
4. **Feature-sized plans with acceptance criteria** — each plan is shippable and verifiable alone; no cross-plan mysteries.
5. **Tests travel with features** — every plan lists its tests; plan-9 consolidates the e2e suite.
6. **Performance budgets** — new indexes (`reviews(product_id, status, created_at)`, `wishlist_items(user_id)`, `product_variants(product_id)`, attribute-value lookups); reviews paginated; storefront queries stay ≤ 300ms with seeded data.
7. **No scope creep inside a plan** — stretch ideas go to plan-10, not into whatever plan is open.

---

## 7. Definition of done (phase 2)

- [ ] A seller can define a product type with attributes, generate variants (e.g. size × color), and manage per-variant price/stock/images.
- [ ] The storefront shows spec sheets, variant selectors with per-variant price/stock, and variant-aware cart/checkout/orders (order items snapshot the variant).
- [ ] Verified purchasers can review (1–5) with moderation, seller replies, helpful votes; products show rating stars and support rating sort/filter.
- [ ] Wishlist: heart on cards/detail, `/account/wishlist`, move-to-cart.
- [ ] Product pages show brand, condition, summary, weight/dimensions, spec sheet, related products; images support reorder + primary.
- [ ] Catalog management: bulk archive/activate, duplicate product, CSV export, low-stock indicators, category reordering.
- [ ] Storefront: recently viewed products, rating sort/filter, attribute facets.
- [ ] Every new server function has integration coverage; Playwright e2e runs the critical paths locally; seeds cover types/attributes/variants/reviews/wishlist.
- [ ] Gates stay green: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `/api/health`.
