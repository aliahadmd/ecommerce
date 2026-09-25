-- Plan-5 backfill: every existing product gets a default variant copying its
-- product-level price/stock/weight/primary image, so it stays purchasable
-- unchanged. Idempotent via NOT EXISTS.
INSERT INTO product_variants (product_id, sku, title, price_cents, stock, weight_grams, image_id, is_default, status, position)
SELECT
  p.id,
  'P-' || upper(substr(replace(p.id::text, '-', ''), 1, 12)),
  'Default',
  p.price_cents,
  p.stock,
  p.weight_grams,
  pi.id,
  true,
  p.status,
  0
FROM products p
LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.sort_order = 0
WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id);
