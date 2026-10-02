# Developer guide — Ecommerce multi-vendor marketplace

> Client-facing demo overview: [../README.md](../README.md)

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
S3 keys, is inline; Postgres extensions come from the first migration), so it
also works when the repo lives on a drive Docker Desktop can't share — e.g. an
external disk that holds Docker's own data.

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

## Deploying (single demo server + Cloudflare Tunnel)

Same pattern as the other projects on the server: everything runs in Docker
(`docker-compose.prod.yml`, Compose project `ecommerce-prod`); the **only
published port is the Caddy proxy on `127.0.0.1:$PROXY_PORT`** (loopback —
never `0.0.0.0`; Docker bypasses host firewalls). Caddy routes `/storage/*`
(read-only) to SeaweedFS for product images and everything else to the web
app. postgres, redis, seaweedfs, mailpit (internal mail sink), web and worker
stay on the project's private network. A host `cloudflared` tunnel routes a
public hostname to the port.

```bash
# one-time on the server
git clone https://github.com/aliahadmd/ecommerce.git /opt/apps/ecommerce
echo "30002 ecommerce" >> /opt/apps/PORTS          # next free loopback port
/opt/apps/ecommerce/deploy/deploy.sh               # generates .env, builds, migrates, seeds, starts
( crontab -l; echo '* * * * * /opt/apps/ecommerce/deploy/deploy.sh >> /var/log/ecommerce-deploy.log 2>&1' ) | crontab -
# Cloudflare dashboard → tunnel → public hostname → http://localhost:30002
# then set PUBLIC_URL=https://<hostname> in /opt/apps/ecommerce/.env and run deploy.sh --force
```

**Continuous deployment is pull-based:** cron runs `deploy/deploy.sh` every
minute; it redeploys only when `origin/main` moved (`git reset --hard` +
`docker compose up -d --build`, which runs the one-shot `migrate` service —
migrations + idempotent seed — before web/worker start). A failing commit is
skipped until a new push (or `--force`). No SSH keys in GitHub, no inbound
access. Server secrets live in the generated, git-ignored `.env` (`chmod 600`);
deploys never rewrite it.

Demo-host settings (in that `.env`): demo data is seeded
(`ALLOW_DEMO_SEED=true`), sign-up needs no email verification, card payments
use the built-in fake gateway, and the super admin / demo user passwords are
random — read them with `grep -E 'SUPER_ADMIN|DEMO_USER' /opt/apps/ecommerce/.env`.
For a real deployment set `ALLOW_DEMO_SEED=false`,
`AUTH_REQUIRE_EMAIL_VERIFICATION=true`, real SMTP and Stripe keys.

## Plans

- Architecture and history: `plans/phase1` … `plans/phase3` (as-built records).
- Audit backlog and resolutions: [`plans/README.md`](../plans/README.md) and
  [`plans/audit-2026-09-30.md`](../plans/audit-2026-09-30.md).
