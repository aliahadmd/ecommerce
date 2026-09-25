# Plan 5 — Variants

**Status:** Draft — awaiting approval
**Depends on:** plan-4 (types & attributes)
**Estimated effort:** 2.5–3 days — the largest plan in phase 2

---

## Goal

Products become sellable in **variants** — per-SKU price, stock, option combination (e.g. Size=M / Color=Red), weight, and image. Cart, checkout, orders, and the seller dashboards become variant-aware while every existing product keeps working.

## Schema (two migrations, per plan-1's additive principle)

**Migration A (structure):**

```sql
CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  title text NOT NULL,                       -- "M / Red"
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  weight_grams integer CHECK (weight_grams >= 0),
  image_id uuid REFERENCES product_images(id) ON DELETE SET NULL,
  is_default boolean NOT NULL DEFAULT false,
  status product_status NOT NULL DEFAULT 'active',   -- reuse draft/active/archived
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_variants_product_idx ON product_variants (product_id, position);

CREATE TABLE variant_option_values (
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  attribute_id uuid NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  value text NOT NULL,               -- must be one of the attribute's options
  PRIMARY KEY (variant_id, attribute_id)
);

ALTER TABLE cart_items ADD COLUMN variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE;
ALTER TABLE order_items ADD COLUMN variant_id uuid REFERENCES product_variants(id) ON DELETE RESTRICT;
-- relax old unique constraint to be variant-aware:
ALTER TABLE cart_items DROP CONSTRAINT cart_items_unique;
CREATE UNIQUE INDEX cart_items_cart_variant_unique ON cart_items (cart_id, product_id, variant_id);
```

**Migration B (backfill, runs in the same release):** for every product **without** a variant, insert a default variant copying `price_cents`, `stock`, `weight_grams`, primary image; `sku = P-<first 8 of product id>`; `is_default = true`; mark `product.status` unchanged. Also relax `order_items.product_id` … stays as is (product remains the anchor; variant is supplementary).

**Aggregate rule:** `products.price_cents` = min(price of active variants), `products.stock` = sum(stock) — recomputed in the same transaction as every variant write (`recomputeProductAggregates(tx, productId)`). Products are never edited price/stock directly anymore once they have variants (form hides those fields when `variantCount > 0`).

## Server functions (`server/variants.ts`)

| Function | Auth | Behavior |
| --- | --- | --- |
| `listVariants({ productId })` | public-active / owner-any | Variants + their option values (+ image) |
| `generateVariants({ productId })` | owner/admin | Cartesian product over the product's variant-axis attributes' selected options; skips existing combinations; each gets `sku = <productSku>-<idx>`, inherits product price/stock; `is_default` on the first |
| `upsertVariant({ productId, variant? , options? })` | owner/admin | Create/update one variant: zod (sku format `^[A-Za-z0-9-]{3,40}$`, price > 0, stock ≥ 0, options must match the axes exactly); recomputes aggregates in-tx |
| `deleteVariant({ variantId })` | owner/admin | Blocked if referenced by order_items (restrict will throw — pre-check for a clean error); blocked if it's the last variant |
| `setDefaultVariant({ productId, variantId })` | owner/admin | Single default (unset others in-tx) |
| `assignVariantImage({ variantId, imageId })` | owner/admin | Variant thumbnail from the product's images |

**Cart changes (`server/commerce.ts`):** `addToCart`/`updateCartItem` take `variantId` (required for products with variants); stock/price checks move to the variant row; `loadCartItems` joins variants (title = `product.title — variant.title`, price from variant, image = variant image ?? product image); `placeOrder` decrements **variant** stock (same `stock >= qty` guard), re-validates variant status, and snapshots `variant_id` + `variant_title` onto `order_items`. Product aggregates recompute in the same transaction when stock moves.

**Storefront:**
- Product page: for products with variant axes, render option selectors (single-select per axis, disabled combinations greyed when that variant is out of stock), price/stock/sku/image react to the selection; Add to cart submits the chosen `variantId`.
- Product cards: unchanged (they already read product aggregates).
- Order detail/buyer emails: line titles include the variant ("Insulated Water Bottle — 750 ml / Green").

**Seller UI:** new "Variants" section on the edit page — axis summary ("Size × Color"), "Generate combinations" button, table (options, sku, price, stock, status, image, default star) with inline editing + add-variant dialog; product price/stock fields hidden while variants exist (with an explanatory note).

## Acceptance criteria

- [ ] Existing seeded products are purchasable unchanged after migration (default variants backfilled; aggregate columns equal the variant values).
- [ ] Seller generates 6 variants from Size(3) × Color(2); each has unique sku; duplicates ("M/Red" twice) are rejected.
- [ ] Storefront selector: choosing "M / Red" shows that variant's price/stock/image; out-of-stock combinations can't be added to cart (server and UI).
- [ ] Cart merges rows per (product, variant); buyer can hold "M/Red" ×2 and "L/Blue" ×1 of the same product.
- [ ] Checkout decrements the chosen variants' stock; order items snapshot variant title/id; cancellation restores variant stock.
- [ ] Product aggregates stay consistent after every variant mutation (spot-check SQL: min price & sum stock).
- [ ] Deleting a variant referenced by an order gives a clean error; deleting the last variant is blocked.
- [ ] All writes zod-validated, ownership-checked, gates green.

## Explicitly not in this plan

Per-variant SEO, variant-level bulk CSV edit, infinite axes (phase 2 caps axes at 3 for UI sanity — server enforces ≤ 3 variant-axis attributes per type).
