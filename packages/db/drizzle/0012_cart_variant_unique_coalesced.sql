-- The (cart_id, product_id, variant_id) unique index treats NULLs as distinct,
-- so duplicate NULL-variant rows for the same product could be inserted under
-- concurrency. COALESCE collapses NULL to a constant so the index enforces
-- one row per (cart, product, variant-or-plain).
DROP INDEX "cart_items_cart_variant_unique";
CREATE UNIQUE INDEX "cart_items_cart_variant_unique"
  ON "cart_items" ("cart_id", "product_id", COALESCE("variant_id", '00000000-0000-0000-0000-000000000000'::uuid));
