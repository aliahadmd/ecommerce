# Plan 8 — Storefront Enhancements

**Status:** Draft — awaiting approval
**Depends on:** plan-3 (wishlist), plan-5 (variants), plan-6 (reviews)
**Estimated effort:** 1.5 days

---

## Goal

Turn the phase-1 storefront into a discovery surface: recently viewed products, rating sort/filter, attribute facets, and small delightors (wishlist-aware cards, variant-aware search results).

## Features

### 1. Recently viewed products
- **Client-led, no schema**: a `recentlyViewed` TanStack Store list (max 12 product slugs) persisted to `localStorage`; the product detail page prepends its slug on mount (dedup, cap 12).
- `/` home gains a "Recently viewed" strip (hidden when empty) that batch-fetches cards via `listProductsBySlugs({ slugs })` (public; filters to active; preserves the localStorage order).
- No account sync in phase 2 (localStorage only) — noted in plan-10.

### 2. Rating sort & filter
- `/products` gains: sort option `rating-desc` (products with `rating_count > 0` first by `rating_avg desc`, then `rating_count desc`), and a "4★ & up" filter checkbox (translates to `rating_avg >= 4`).
- Index to support it: `products_rating_idx ON products (status, rating_avg DESC, rating_count DESC)` — added in this plan's migration.

### 3. Attribute facets
- Filter sidebar section "Specifications" built from `getAttributeFacets({ categorySlug })` (plan-4): for each filterable attribute present in the category, top 8 values as checkboxes (multi-select → `OR` within the attribute, `AND` across attributes).
- URL contract: `?a_material=Steel&size=M` — search-param schema extended (`a_<slug>` params); server `listProducts` applies them via `EXISTS` subqueries over `product_attribute_values` (jsonb value containment for multiselect: `@>`).
- Facet counts (`value → product count`) come from the facets query; zero-count values are hidden.
- Performance guard: facets only compute when a category is selected (category-less facet queries are O(wide) and deferred).

### 4. Variant-aware storefront touches
- Product cards show "N options" chip when the product has variants (clicking goes to the detail page — variant selection stays on the detail page; no card-level variant pickers in phase 2).
- Search matches variant SKUs: `listProducts` q-search also `EXISTS` over `product_variants.sku` (exact-prefix match), so "P-AB12" finds the product.

### 5. Wishlist-aware grids
- Product cards on `/products`, `/`, `/shops/$slug`, and related-products rows render `WishlistHeart` (plan-3) — one batched status call per grid via the existing hook.

## Server functions (new/extended)

| Function | Behavior |
| --- | --- |
| `listProducts` extended | `rating` filters/sort, attribute-facet params (`a_*`), variant-sku search |
| `listProductsBySlugs({ slugs })` | Public; active only; ordered by the given slugs; used by the recently-viewed strip |
| `getAttributeFacets({ categorySlug })` | From plan-4, now consumed (facet value counts per filterable attribute) |

## Acceptance criteria

- [ ] Viewing 3 products populates "Recently viewed" on the home page in order; archived products drop out of the strip automatically.
- [ ] `?sort=rating-desc` orders by rating; the "4★ & up" filter composes with category/tag/q filters.
- [ ] Selecting facet values updates the URL and results (shareable/back-button works); counts match the filtered category.
- [ ] Searching a variant SKU returns its product.
- [ ] Cards across the named grids show wishlist hearts with batched lookups (network tab: ≤ 1 status call per grid).
- [ ] Facet queries < 150ms with seeded data; `listProducts` composite queries < 300ms.
- [ ] Gates green; new query paths integration-tested (plan-9).

## Explicitly not in this plan

Cross-account recently-viewed sync, full-blown faceted search engine (pgvector/trigram hybrid ranking is plan-10), infinite scroll.
