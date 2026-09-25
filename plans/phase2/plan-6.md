# Plan 6 — Reviews & Ratings

**Status:** Draft — awaiting approval
**Depends on:** plan-2 (product page layout)
**Estimated effort:** 2 days

---

## Goal

Verified purchasers review products (1–5 stars), sellers reply, admins moderate, and the storefront surfaces rating aggregates everywhere products appear.

## Schema (migration: additive)

```sql
CREATE TYPE review_status AS ENUM ('approved', 'hidden');

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL,  -- verified-purchase proof
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 2000),
  status review_status NOT NULL DEFAULT 'approved',
  seller_reply text,
  seller_replied_at timestamptz,
  helpful_count integer NOT NULL DEFAULT 0 CHECK (helpful_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_product_user_unique UNIQUE (product_id, user_id)
);
CREATE INDEX reviews_product_status_idx ON reviews (product_id, status, created_at DESC);

CREATE TABLE review_votes (
  review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (review_id, user_id)
);

ALTER TABLE products
  ADD COLUMN rating_avg numeric(3,2) NOT NULL DEFAULT 0 CHECK (rating_avg >= 0 AND rating_avg <= 5),
  ADD COLUMN rating_count integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0);
```

**Aggregate maintenance (`recomputeProductRating(tx, productId)`):** `avg(rating)` + `count` over `status = 'approved'` rows; called in the same transaction as create/hide/unhide/delete/reply. Plan-1's "recompute" admin tool is `adminRecomputeRatings({ productId? })` (all products when omitted) — the safety net.

## Server functions (`server/reviews.ts`)

| Function | Auth | Behavior |
| --- | --- | --- |
| `listReviews({ productId, page, sort })` | public | Approved reviews w/ author first-name + initial, verified badge, seller reply, own-vote flag; 10/page; sort `newest \| helpful` |
| `myReview({ productId })` | user | The caller's review (for edit UI) |
| `canReview({ productId })` | user | `{ eligible, reason }` — true when the user has a paid/delivered order item for this product and hasn't reviewed yet (the verified-purchase check is `EXISTS` over order_items→orders where buyer + product + payment_status in ('paid') or status in ('delivered')) |
| `createReview({ productId, rating, title, body })` | user | Same eligibility re-check server-side; insert with the matching order_item_id; recompute aggregates; one-review-per-user enforced by unique constraint (friendly "already reviewed" error) |
| `updateReview({ reviewId, rating, title, body })` | author | Own review only, within 30 days of creation (edited badge) |
| `deleteReview({ reviewId })` | author or admin | Author any time; admin any; recompute |
| `voteReview({ reviewId })` | user | Toggle helpful vote; `helpful_count` maintained in-tx |
| `replyToReview({ reviewId, reply })` | product's seller or admin | One reply, editable; ≤ 1000 chars |
| `setReviewStatus({ reviewId, status })` | admin | approved ↔ hidden; recompute |
| `adminListReviews({ status?, page })` | admin | Moderation table incl. reported-abuse placeholder column |

No anonymous reviews, no edits by sellers to review content, no photos in reviews (stretch, plan-10).

## UI

- **Product page — Reviews section**: rating summary block (big average, star row, 5→1 distribution bars, count) + "Write a review" button (visible when `canReview` is true; otherwise disabled with the reason: "Purchase this product to review it" / "You already reviewed"); list with verified-purchase badge, helpful button (count, toggled state), seller reply styled distinctly; pagination.
- **Product cards**: ★ 4.6 (23) next to price — hidden when `rating_count = 0`.
- **Product page header**: compact stars under the title linking to the reviews section.
- **Seller dashboard**: "Reviews" nav entry — their products' reviews, reply composer, average rating per product.
- **Admin** `/admin/reviews`: moderation table (product, user, rating, status, helpful count), hide/unhide, delete.

## Star rendering

`StarRating({ value, size? })` component — lucide `Star` with half-fill via gradient clip; used in summary, cards, reviews. No new dependency.

## Acceptance criteria

- [ ] Buyer with a paid order can review; buyer without one sees the disabled state; second review is rejected server-side.
- [ ] Review appears instantly (approved default); aggregates on the product/card update in the same request.
- [ ] Author edits within 30 days ("edited" badge); cannot edit others'.
- [ ] Helpful vote toggles; count matches rows (SQL spot-check); self-vote allowed (MVP) but only one per user.
- [ ] Seller reply renders under the review; only the product's seller (or admin) can reply.
- [ ] Admin hiding a review removes it from lists and from aggregates; unhiding restores.
- [ ] Review deletion by admin recomputes aggregates.
- [ ] 200 seeded reviews: product page list paginates (≤ 10/page), `listReviews` stays < 100ms.

## Explicitly not in this plan

Review photos/videos, abuse reporting flow, review invitations by email, Q&A section (plan-10).
