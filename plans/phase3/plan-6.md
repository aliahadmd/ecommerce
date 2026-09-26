# Plan 6 — Background Jobs, Email Queue & Notifications

**Status:** Done
**Depends on:** — (integrates with plan-2/3 events)
**Estimated effort:** 2.5 days

---

## Goal

Move all "fire-and-forget" work (transactional email, notifications) onto **BullMQ** backed by the existing Redis, with retries and idempotency; add an **in-app notification center** and **back-in-stock alerts** for wishlist items.

## Package: `packages/jobs` (new)

- `getQueues()` — BullMQ `Queue` instances (`email`, `notify`) using `REDIS_URL`; producers are safe to call from server functions (fire-and-forget becomes `enqueue`, which *acks immediately* but is durable).
- Job types + payloads (discriminated union), dedupe keys: `email:{template}:{orderId}:{to}`, `notify:{event}:{userId}:{entityId}` — dedupe via BullMQ `jobId` (BullMQ dedupes on duplicate jobId while the job exists).
- **Worker**: `apps/worker` (new workspace app, `pnpm worker`) — a Node process running `Worker` instances; started alongside the dev server (documented in README; compose gains an optional `worker` service).

## Queue → handlers

| Queue | Job | Handler |
| --- | --- | --- |
| email | `verification`, `password_reset`, `order_placed`, `order_status`, `payment_received`, `order_cancelled`, `back_in_stock` | Reuse `packages/email` senders; retries ×5 exponential; dead-letter logged |
| notify | `order_status`, `payment_received`, `back_in_stock` | Insert `notifications` row |

Migrations of existing call sites: `commerce.ts`/`reviews.ts`/`auth` email hooks call `enqueueEmail(...)` instead of `sendXxx(...)` directly. `auth`'s better-auth hooks also enqueue (verification/reset) — auth package gains an optional mailer injection.

## Notifications (schema: additive)

```sql
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
  kind text NOT NULL,               -- 'order_status','payment_received','back_in_stock'
  title text NOT NULL,
  body text,
  link text,                        -- in-app target, e.g. /account/orders/{id}
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
```

Server fns: `listNotifications({ unreadOnly?, page })`, `markRead({ ids })`, `markAllRead()`, `unreadCount()` (polled by the header, 30s).

**Back-in-stock**: when `stock` transitions 0 → >0 (checkout cancel, variant restock, admin edit), enqueue `back_in_stock` for wishlist users of that product (subject to a per-user notifications table check). Wishlist table already exists.

## UI

- **Bell** in the header (next to cart) with unread count badge; dropdown lists the latest 8 with links; "Mark all read".
- **`/account/notifications`**: full list, read/unread, mark-all.
- Emails unchanged visually (same templates), now delivered via the queue.

## Acceptance criteria

- [ ] Order lifecycle emails arrive via the queue (worker logs; Mailpit), including on web-server restart (jobs persist in Redis).
- [ ] A failing email job retries 5× with backoff, then dead-letters with an error log; the user flow never blocks.
- [ ] Duplicate events (double enqueue) create one email/one notification (jobId dedupe verified).
- [ ] Notification bell shows unread count; clicking marks read and navigates; mark-all works.
- [ ] Restocking a wishlist product notifies its wishlist users exactly once per restock event.
- [ ] Worker runs as a separate process; `docker compose` profile starts it; kill −9 of the web server never loses an enqueued job.

## Explicitly not in this plan

Websockets/push (polling is fine at this scale), user notification preferences UI, digest emails.

---

## As-built note (2026-09-26)

BullMQ email+notify queues, separate apps/worker process (tsx), retries with exponential backoff, jobId dedupe. In-app notifications + bell + /account/notifications page. Back-in-stock fires on sub-order cancellation restock.
