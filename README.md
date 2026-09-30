# Ecommerce — multi-vendor marketplace

AliExpress/Taobao-style marketplace: **super admin / seller / buyer** roles,
catalog with variants, per-shop sub-orders, **cash-on-delivery and card**
payments, coupons, seller ledger and payouts, background email/notification
jobs. TanStack Start monorepo, infra in Docker, Dokploy-ready packaging.

## Quickstart (fresh machine, <10 min)

Prerequisites: Docker Desktop, Node ≥ 22 (nvm: `nvm use`), pnpm (`corepack enable` — the version comes from `packageManager` in `package.json`).

```bash
make env         # create .env from .env.example
make install     # pnpm install
make up          # start postgres+pgvector, redis, seaweedfs, mailpit
make migrate     # apply DB migrations
make seed        # seed demo data + super admin (idempotent, dev only)
make dev         # start the app → http://localhost:3000
make worker      # (second terminal) job worker: emails + in-app notifications
```

Without `make worker`, order/status emails and notifications stay queued in
Redis (sign-up verification and password-reset emails are sent directly).

Demo accounts (created by the seed — **development only**):

| Role        | Email              | Password      |
| ----------- | ------------------ | ------------- |
| super admin | `admin@dev.local`  | `Admin1234!`  |
| seller      | `seller@dev.local` | `Seller1234!` |
| buyer       | `buyer@dev.local`  | `Buyer1234!`  |

The dev compose file uses no host bind mounts (the only config, SeaweedFS's
S3 keys, is inline), so it also works when the repo lives on a drive Docker
Desktop can't share — e.g. an external disk that holds Docker's own data.

## Services (dev)

| Service             | URL / port                       | Notes                                                    |
| ------------------- | -------------------------------- | -------------------------------------------------------- |
| Web app             | http://localhost:3000            | TanStack Start (SSR + server functions)                  |
| Mailpit UI          | http://localhost:8025            | every dev email (verification, order mails) — SMTP :1025 |
| SeaweedFS master UI | http://localhost:9333            | S3 API on :8333, filer UI on :8888                       |
| Drizzle Studio      | `make studio`                    | database browser                                         |
| Health              | http://localhost:3000/api/health | db/redis/storage checks                                  |

## What's implemented

- **Auth**: register → email verification → login; sessions; password reset; admin role/ban management (bans end sessions immediately).
- **Catalog**: nested categories, tags, product types with typed attributes, variants (per-SKU price/stock/image), images on S3, reviews (verified purchase, photos, helpful votes, seller replies, abuse reports + moderation), wishlist, facets, CSV export/import (all-or-nothing, drafts).
- **Orders**: cart → checkout splits into per-shop sub-orders; each seller fulfils their slice (confirm → ship → deliver); the order status is derived from its sub-orders; cancellation restores stock.
- **Payments**: COD (seller records "Cash received" after delivery) or card via the provider abstraction — a local fake gateway in dev, Stripe Checkout + signed webhooks when configured. Unpaid card orders can be retried by the buyer and are auto-cancelled after `CARD_PAYMENT_TTL_MINUTES`; cancelling a paid card sub-order refunds it.
- **Coupons**: percent / fixed / free shipping, cart-wide or shop-scoped (discounts only that shop), usage limits enforced in the checkout transaction.
- **Money**: seller ledger (sale per delivered sub-order, commission from the admin setting), seller statements, admin payouts.
- **Ops**: store settings (maintenance mode and sign-up switch are enforced server-side), BullMQ worker, AI description/tag suggestions via OpenRouter (optional — set `OPENROUTER_API_KEY`).

## Scripts & gates

`make dev/worker/build/lint/typecheck/test/migrate/seed/studio/up/down/reset/logs` —
see the Makefile. Gates: `pnpm typecheck`, `pnpm lint`, `pnpm test` (Vitest:
money, order state machine, order split/status rules, CSV), and the Playwright
suite (`cd apps/web && npx playwright test`, needs `make up`, `make seed`,
`make dev` and `make worker`).

## Deploying (Dokploy)

Two stateless containers built from this repo; every dependency is an external
service referenced only via env vars (contract: `.env.example`).

| Concern         | Approach                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------ |
| App             | **`Dockerfile`**; healthcheck `/api/health`; domain via Dokploy proxy                             |
| Worker          | **`Dockerfile.worker`** — required for order emails/notifications; same env as the app; heartbeat healthcheck |
| Postgres        | Dokploy Postgres template **or** external (Postgres 17 + pgvector) — `DATABASE_URL`             |
| Redis           | Dokploy Redis template or external — `REDIS_URL`                                                |
| Object storage  | External S3 / SeaweedFS / Minio — `S3_*`                                                         |
| SMTP            | External provider — `SMTP_*` (Mailpit is dev-only)                                               |
| Payments        | `PAYMENT_PROVIDER=stripe` + `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`; point the Stripe webhook at `/api/payments/callback`. The fake gateway is dev-only. |
| Migrations      | One-off `pnpm db:migrate` before each deploy                                                     |
| First admin     | One-off `pnpm db:seed -- --admin-only` with `SUPER_ADMIN_EMAIL` + a strong `SUPER_ADMIN_PASSWORD` (the demo seed refuses to run in production) |

In production the app refuses to boot with missing or dev-default secrets.
`docker-compose.prod.example.yml` shows the same wiring in compose form.

## Plans

- Architecture and history: `plans/phase1` … `plans/phase3` (as-built records).
- Audit backlog and resolutions: [`plans/README.md`](plans/README.md) and
  [`plans/audit-2026-09-30.md`](plans/audit-2026-09-30.md).
