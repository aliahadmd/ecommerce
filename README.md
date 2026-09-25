# Ecommerce — multi-vendor marketplace (phase 1)

AliExpress/Taobao-style marketplace MVP: **super admin / seller / buyer** roles,
catalog with images, cart + **cash-on-delivery** orders. TanStack Start
monorepo, infra fully in Docker, Dokploy-ready packaging.

## Quickstart (fresh machine, <10 min)

Prerequisites: Docker Desktop, Node ≥ 22 (nvm: `nvm use`), pnpm ≥ 9 (`corepack enable` or `npm i -g pnpm`).

```bash
make env         # create .env from .env.example
make install     # pnpm install
make up          # start postgres+pgvector, redis, seaweedfs, mailpit
make migrate     # apply DB migrations
make seed        # seed demo data + super admin (idempotent)
make dev         # start the app → http://localhost:3000
```

Demo accounts (created by the seed):

| Role | Email | Password |
| --- | --- | --- |
| super admin | `admin@dev.local` | `Admin1234!` |
| seller | `seller@dev.local` | `Seller1234!` |
| buyer | `buyer@dev.local` | `Buyer1234!` |

## Services (dev)

| Service | URL / port | Notes |
| --- | --- | --- |
| Web app | http://localhost:3000 | TanStack Start (SSR + server functions) |
| Mailpit UI | http://localhost:8025 | every dev email (verification, order mails) — SMTP :1025 |
| SeaweedFS master UI | http://localhost:9333 | S3 API on :8333, filer UI on :8888 |
| Drizzle Studio | `make studio` | database browser |
| Health | http://localhost:3000/api/health | db/redis/storage checks |

## What's implemented (phase 1)

- Auth: register → email verification (Mailpit) → login; sessions; password reset.
- Roles: `super_admin` / `seller` / `buyer`; buyers become sellers by creating a shop (`/seller/onboarding`); admin role/ban management.
- Catalog: categories (nested), tags, products with images (SeaweedFS S3), storefront browse with search/filters/sort/pagination, shop pages.
- Cart & orders: cart, checkout with saved addresses, COD orders, seller fulfillment (confirm → ship → delivered → mark paid), cancellation with stock restore, transactional emails.
- Dashboards: admin (stats, orders/day chart, users), seller (stats, chart, recent orders).
- AI (optional): product description + tag suggestions via OpenRouter — set `OPENROUTER_API_KEY` in `.env` to enable; hidden when unset.

## Scripts

`make dev/build/lint/typecheck/test/migrate/seed/studio/up/down/reset/logs` —
see the Makefile; `pnpm test` runs the Vitest suite (order state machine,
money/slug utils).

## Deploying later (Dokploy)

The app is a stateless container (`Dockerfile` at repo root, healthcheck on
`/api/health`). All dependencies are external services referenced only via env
vars (contract in `.env.example`, plan-1 §7):

| Dokploy concern | Approach |
| --- | --- |
| App | Service from the repo **Dockerfile**; healthcheck path `/api/health`; domain via Dokploy proxy |
| Postgres | Dokploy Postgres template **or** external — only `DATABASE_URL` |
| Redis | Dokploy Redis template or external — only `REDIS_URL` |
| Object storage | External S3 / SeaweedFS / Minio — only `S3_*` vars |
| SMTP | External provider — only `SMTP_*` vars (Mailpit is dev-only) |
| Migrations | One-off command `pnpm db:migrate` (needs devDeps) before first deploy |

`docker-compose.prod.example.yml` shows the same wiring in compose form.

## Plans

Phase-1 plans live in [`plans/phase1`](plans/phase1/plan-1.md) — plan-1 is the
architecture map; each plan file records its status and as-built deltas.
