# Plan 3 — Wishlist (Saved Products)

**Status:** Done
**Depends on:** — (independent)
**Estimated effort:** 0.5–1 day

---

## Goal

Authenticated buyers can save products to a wishlist: heart toggle everywhere a product appears, a dedicated `/account/wishlist` page, and move-to-cart from the wishlist.

## Schema (migration: additive)

```sql
CREATE TABLE wishlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wishlist_items_user_product_unique UNIQUE (user_id, product_id)
);
CREATE INDEX wishlist_items_user_idx ON wishlist_items (user_id, created_at DESC);
```

## Server functions (`server/wishlist.ts`)

| Function | Auth | Behavior |
| --- | --- | --- |
| `listWishlist()` | user | Wishlist products as product cards (reuse catalog's card query shape), newest first, only `active` products shown |
| `toggleWishlist({ productId })` | user | Insert or delete; returns `{ saved: boolean }`; product must exist & be active |
| `wishlistStatus({ productIds })` | user | `string[]` of saved ids — batched lookup for card grids |

The wishlist is per-user only (no guest wishlists, no shareable lists — plan-10 stretch).

## UI

- **Heart toggle** on: product detail page (next to Add to cart), product cards (`ProductCard`), wishlist page rows.
  - Component `WishlistHeart({ productId, initial? })` — TanStack Query mutation calling `toggleWishlist`, optimistic flip, login redirect (`/login?redirect=<current>`) when `UNAUTHORIZED` (same pattern as add-to-cart).
  - Cards fetch saved-status via one batched `wishlistStatus` call per grid (a small `useWishlistSet(productIds)` hook with a module-level cache keyed by user id to avoid N calls).
- **`/account/wishlist`**: grid of saved products with heart (unsave), "Add to cart" (variant-aware once plan-5 lands; until then product-level), empty state. Linked from `/account` buttons and the account dropdown.
- **Header**: no wishlist icon yet (account menu link is enough); consider one in plan-8.

## Acceptance criteria

- [ ] Heart on detail + cards toggles without a page reload; state persists across sessions.
- [ ] Logged-out click → redirected to login with redirect back; after login the heart reflects the pre-login intent.
- [ ] `/account/wishlist` lists saved products; removing (heart) updates the page optimistically.
- [ ] Archiving a product hides it from wishlist reads but keeps the row (re-activation restores it).
- [ ] Double-toggle race can't duplicate rows (DB unique + `onConflictDoNothing`).
- [ ] Batched status lookup: a 12-card grid triggers at most 1 extra server call.

## Explicitly not in this plan

Shareable/public wishlists, wishlists for guests, price-drop alerts (plan-10).

---

## As-built note (2026-09-26)

As planned; batched wishlistStatus per grid.
