# Plan 7 — Catalog Management Enhancements

**Status:** Done
**Depends on:** plan-2 (details/threshold), plan-5 (variants)
**Estimated effort:** 1.5 days

---

## Goal

Make sellers and admins faster at scale: bulk operations, product duplication, CSV export, low-stock indicators, and category reordering.

## Server functions

**Seller (extend `server/catalog.ts` / new `server/catalog-admin.ts`):**

| Function | Behavior |
| --- | --- |
| `bulkSetProductStatus({ productIds, status })` | Owner-scoped (only own products mutated); archive/activate/draft; returns per-id results; invalidates caches |
| `duplicateProduct({ productId })` | Copy as **draft** with `" (copy)"` title + fresh slug; copies images (new S3 keys — copy objects server-side), tags, attribute values, **and variant structure** (option values; stock/price copied; skus suffixed `-C{n}`); does NOT copy reviews (by definition) |
| `exportProductsCsv()` | Seller's products (admin: all) streamed as CSV: title, slug, type, brand, condition, price, sale info, stock (product-level + per-variant rows with `variant_title`), status, rating; proper quoting; `Content-Disposition: attachment` |
| `setLowStockThreshold({ productId, threshold })` | Folded into productFields (plan-2) — no separate fn |

**Category reordering:** `reorderCategories({ parentId, orderedIds })` — admin; rewrites `sort_order` for siblings in one transaction; validates the id set matches the sibling set exactly.

## UI

- **Seller products table**: checkbox column + bulk bar ("3 selected — Archive / Activate / Delete drafts"), sticky on scroll; bulk actions confirm once and toast a summary; invalid selections (e.g. archive an already-archived) are skipped server-side and reported.
- **Row menu** gains "Duplicate" (navigates to the new draft's edit page) and "Export CSV" lives in the table header.
- **Low-stock indicators**: rows where `stock <= low_stock_threshold` get an amber "Low stock" chip (variants: any variant below threshold); seller dashboard stat card "Low stock products" linking to a pre-filtered list (`?filter=low-stock`).
- **Admin category tree** (`/admin/catalog`): up/down arrows per node (persisted via `reorderCategories`), drag handles deferred (arrows are honest and keyboard-accessible).

## CSV export details

- Streaming response (`ReadableStream`), UTF-8 with BOM (Excel-safe), RFC-4180 quoting; filename `products-YYYYMMDD.csv`.
- Two row kinds: product rows and variant rows (columns `row_kind`, blank fields where N/A) — importable-shape-compatible with a future import feature (plan-10).

## Acceptance criteria

- [ ] Bulk archive of 5 products in one action; non-owned ids are ignored (server-verified with a cross-seller attempt).
- [ ] Duplicate creates a draft with copied images/attributes/variants; the copy is immediately editable and publishable; original untouched.
- [ ] CSV downloads with correct quoting (title containing comma/quote round-trips in a spreadsheet app); admin export includes all shops.
- [ ] Low-stock chip appears when stock ≤ threshold (product-level and per-variant); dashboard card count matches.
- [ ] Category reorder persists; reordering siblings of one parent never disturbs others.
- [ ] Gates green; bulk/duplicate/export are integration-tested (plan-9).

## Explicitly not in this plan

CSV import, drag-and-drop category trees, scheduled exports, product feeds (plan-10).

---

## As-built note (2026-09-26)

As planned; duplicate copies images by reference (rows point at same S3 keys — no object copy needed); CSV streamed with RFC-4180 quoting + BOM.
