# Plan 2 — Richer Product Details & Image Management

**Status:** Draft — awaiting approval
**Depends on:** — (independent)
**Estimated effort:** 1–1.5 days

---

## Goal

Give products real marketplace-grade detail: brand, condition, short summary, weight/dimensions (feeding future shipping), SEO fields, and a proper image experience (reorder, primary, per-variant image in plan-5). Plus computed "related products".

## Schema (migration: additive)

```sql
ALTER TABLE products
  ADD COLUMN brand text,
  ADD COLUMN summary text,                    -- short pitch ≤ 300 chars, shown under the title
  ADD COLUMN condition product_condition NOT NULL DEFAULT 'new',   -- enum: new | used | refurbished
  ADD COLUMN weight_grams integer CHECK (weight_grams >= 0),
  ADD COLUMN dimensions jsonb,                -- { l, w, h } in mm, all >= 0
  ADD COLUMN seo_title text,
  ADD COLUMN seo_description text,
  ADD COLUMN low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0);
```

- `dimensions` validated with zod (l/w/h integers 0–100000) — no DB check needed beyond type.
- `low_stock_threshold` lands now; it powers plan-7's low-stock indicators.
- product_images gains `updated_at` (already has) — no change; reorder exists (sort_order).

## Server functions (extend `server/catalog.ts`)

- `productFields` validation extended: `brand?` (≤ 80), `summary?` (≤ 300), `condition` enum, `weightGrams?`, `dimensions?`, `seoTitle?` (≤ 200), `seoDescription?` (≤ 300), `lowStockThreshold?` (int ≥ 0).
- `reorderProductImages({ productId, imageIds: string[] })` — seller/admin, ownership-checked; writes `sort_order` 0..n in one transaction; validates the id set matches the product's images exactly.
- `listRelatedProducts({ slug, limit? })` — same **category** (fallback: same shop), `status = active`, exclude self, order by `rating_count desc, created_at desc`, limit 4. Plain computed query — no table.

## UI

- **Seller product form**: new sections — "Details" (brand, condition select, summary with live char count, weight, dimensions l/w/h, low-stock threshold) and "SEO" (collapsible: seo title/description with Google-style preview snippet).
- **Edit page**: image grid gains drag-to-reorder (HTML5 drag events, order persisted via `reorderProductImages`) and an explicit "Set primary" stays.
- **Product page**: summary under the title; brand/condition/weight/dimensions rows in a "Details" block above the description; `<title>`/description meta already driven by loader — switch to `seo_title ?? product.title` and `seo_description ?? summary ?? description.slice(0,160)`.
- **Product page bottom**: "Related products" grid (`listRelatedProducts`).
- **Product cards**: show condition badge when `used`/`refurbished`, brand line when present.

## Acceptance criteria

- [ ] Seller sets brand/condition/summary/weight/dimensions/SEO on the form; values persist and render on the product page.
- [ ] SEO fields override the page `<title>`/description when set (verify in the SSR HTML).
- [ ] Drag-reorder persists after reload; primary image is the first image everywhere.
- [ ] Related products shows 4 same-category products (or same-shop fallback), excluding the current one.
- [ ] `low_stock_threshold` persists and is editable (consumed by plan-7).
- [ ] All inputs zod-validated server-side; non-owner 403; gates stay green.

## Explicitly not in this plan

Videos, 360° media, per-variant images (plan-5), attribute-based specs (plan-4).
