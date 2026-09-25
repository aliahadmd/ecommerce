# Plan 7 — Catalog: Categories, Tags, Products + Storefront

**Status:** Draft
**Depends on:** plan-4, plan-5, plan-6
**Estimated effort:** 2–3 days

---

## Goal

The catalog domain end-to-end: admin manages categories/tags, sellers manage their products (with images), and everyone can browse a public storefront with search and filters. This is the first vertical slice that uses the full stack: server functions + Zod + TanStack Form/Table + shadcn + SeaweedFS.

## Shared validation (`apps/web/src/schemas/catalog.ts`)

Zod schemas reused by forms and server functions:

- `categorySchema`: name (1–80), optional parent, description ≤ 500. Slug derived server-side (`slugify` util + uniqueness suffix on collision).
- `tagSchema`: name (1–40), slug derived.
- `productSchema`: title (3–200), description (10–5000), `price` (decimal string in UI → converted to `priceCents` int server-side), `stock` (int ≥ 0), `categoryId` optional, `tagIds` (array, max 10), `status` (`draft | active`), `images` (handled by plan-6 endpoints, ordered list of image ids).

## Server functions (`apps/web/src/server/catalog.ts`)

| Function | Auth | Notes |
| --- | --- | --- |
| `createCategory` / `updateCategory` / `deleteCategory` | admin | Delete blocked if products reference it (suggest reassign first); circular parents rejected |
| `listCategories` (tree) / `getCategory(slug)` | public | Cached in Redis 60s, invalidated on mutation |
| `createTag` / `updateTag` / `deleteTag` | admin | Delete detaches product_tags |
| `listTags` | public (for filters + form) | |
| `createProduct` / `updateProduct` | seller (own) / admin (any) | Slug uniqueness; on publish, product becomes visible only if shop is active |
| `archiveProduct` | seller (own) / admin | Soft state change (`archived`), never hard delete once ordered |
| `getProduct(slug)` | public | `active` + shop active; owner/admin also see drafts/archived |
| `listProducts(filters)` | public | Filters: category, tag(s), price min/max, q (ILIKE on title/description, pg_trgm), sort (newest/price asc-desc), page |
| `listSellerProducts` | seller | Own shop only, all statuses — TanStack Table server pagination |
| `adminListProducts` / `adminSetProductStatus` | admin | Moderation across shops |

Rules: price/stock changes by a seller never touch existing orders (snapshots in plan-4/8). All mutations invalidate the relevant TanStack Query caches + Redis cache keys.

## Pages

### Public storefront

| Route | Contents |
| --- | --- |
| `/` | Hero, category grid, newest products, "active" only |
| `/products` | Filter sidebar (category tree, tags, price range) + grid + sort + pagination; search box syncs `?q=` |
| `/products/$slug` | Gallery (plan-6 images), price, stock badge, tags, description, seller shop card with link, add-to-cart (plan-8 wires the action; button present but shows "coming next" until plan-8 lands — or land plan-7+8 together) |
| `/shops/$slug` | Simple seller storefront: shop header + their active products |

### Seller (`/seller`, role-gated)

| Route | Contents |
| --- | --- |
| `/seller/products` | TanStack Table: thumbnail, title, price, stock, status, updated; row actions edit/archive; "New product" |
| `/seller/products/new` & `/seller/products/$id/edit` | Product form: TanStack Form + Zod resolver; ImageUploader (plan-6); category select; tag multi-select; save as draft / publish |

### Admin (`/admin`, role-gated)

| Route | Contents |
| --- | --- |
| `/admin/categories` | Tree list + create/edit dialog + delete guard messaging |
| `/admin/tags` | Table + inline create/edit |
| `/admin/products` | All shops' products, filter by status/shop, archive/restore |

## UX details

- Money displayed via a `formatMoney(cents, currency)` util — the only place cents → string happens.
- Empty states everywhere ("No products match these filters", first-run seller with zero products gets a CTA).
- Loading: skeleton components; errors: toast + retry.
- Optimistic updates on archive/tag toggles via TanStack Query.

## Acceptance criteria

- [ ] Admin creates nested categories and tags; they appear in storefront filters.
- [ ] Seller (seeded) creates a product with 3 images → publishes → it appears on `/` and `/products` and its detail page renders.
- [ ] Draft products are invisible to the public (direct URL 404s) but visible to their owner and admin.
- [ ] Search `?q=` matches title fragments; price/tag/category filters compose.
- [ ] Seller B cannot see or edit Seller A's products in list or via server function (403).
- [ ] Editing price does not alter previously placed orders' totals (spot check after plan-8).
- [ ] Pagination works with TanStack Table server mode on `/seller/products`.

## Explicitly not in this plan

Cart & checkout (plan-8), AI description generation hook (plan-10 adds a button to this form), product variants (later phase — schema note: variants would introduce `product_variants`; phase 1 products are single-SKU).
