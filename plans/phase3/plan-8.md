# Plan 8 — Admin Settings & Moderation Upgrades

**Status:** Draft — awaiting approval
**Depends on:** plan-5 (commission rate consumer)
**Estimated effort:** 1.5 days

---

## Goal

An admin **settings page** backed by a typed settings table (maintenance mode, signups toggle, commission rate, contact email), plus moderation upgrades: **review photos** and **review abuse reporting**.

## Settings

```sql
CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Keys (typed in `server/settings.ts` with a zod schema — unknown keys rejected):

| key | type | default | effect |
| --- | --- | --- | --- |
| `store.mode` | `"open" \| "maintenance"` | open | Maintenance: storefront renders a maintenance page for non-admins; API reads stay up |
| `signups.enabled` | boolean | true | Register endpoint rejects with a clear message when off |
| `commerce.commission_rate` | integer (percent 0–50) | 10 | plan-5 ledger reads this at settlement |
| `store.contact_email` | string | EMAIL_FROM address | Shown on the maintenance page + contact links |

Reads go through the phase-2 `cachedJson` (30s TTL); writes invalidate the cache. Enforcement points: register route (signups), root layout / `__root` loader (maintenance), `internals.ts` ledger (commission), footer (contact).

## UI — `/admin/settings`

Form card per group: **Store** (mode radio, contact email), **Signups** (toggle), **Commerce** (commission rate number input with preview: "Seller keeps 90%"). Save per group with optimistic toast. Destructive-free page (no deletes).

## Moderation upgrades

1. **Review photos** (up to 3, reuse the plan-6 upload proxy path, 5MB each, JPEG/PNG/WebP):
   - `reviews.photos jsonb` (array of {url,key}), uploaded **after** review creation via `uploadReviewPhoto({ reviewId, file })` (author-only, max 3);
   - rendered in the review row (thumbnail lightbox via existing dialog);
   - deleting a review cascades photos; S3 objects deleted best-effort.
2. **Abuse reporting**: `POST reportReview({ reviewId, reason ≤ 300 })` — one report per user per review (unique index); sets a `reported_at` on the review; admin reviews table gains a "Reported" filter tab and a dismiss action (clears report, keeps review).

```sql
ALTER TABLE reviews ADD COLUMN photos jsonb NOT NULL DEFAULT '[]';
ALTER TABLE reviews ADD COLUMN reported_at timestamptz;
CREATE TABLE review_reports (
  review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE cascade,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, user_id)
);
```

## Acceptance criteria

- [ ] Maintenance mode: non-admin visitors see the maintenance page on every route; admins browse normally; flipping back restores instantly (cache TTL respected ≤ 30s).
- [ ] Signups off → register returns "Signups are currently disabled" and the UI shows it.
- [ ] Commission change affects only **new** ledger entries (existing entries immutable).
- [ ] Review photos upload (author-only), render, and are capped at 3; deletion removes rows and best-effort S3 objects.
- [ ] Report → appears in admin Reported tab; dismiss clears; duplicate reports impossible (unique index).
- [ ] Settings validation rejects bad values (commission −5, mode "chaos") with field errors.

## Explicitly not in this plan

Seller-facing settings UI, per-shop commission overrides, review edit history audit, automated abuse detection.
