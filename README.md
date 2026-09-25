# Ecommerce — multi-vendor marketplace (phase 1)

AliExpress/Taobao-style marketplace MVP: super admin / seller / buyer roles,
catalog with images, cart + cash-on-delivery orders. TanStack Start monorepo,
infra fully in Docker.

## Quickstart (fresh machine, <10 min)

Prerequisites: Docker Desktop, Node ≥ 22 (nvm: `nvm use`), pnpm ≥ 9 (`corepack enable` or `npm i -g pnpm`).

```bash
make env         # create .env from .env.example
make install     # pnpm install
make up          # start postgres, redis, seaweedfs, mailpit
make migrate     # apply DB migrations
make seed        # seed demo data + super admin
make dev         # start the app → http://localhost:3000
```

Demo credentials (from seed): see `.env` (`SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`)
plus demo seller/buyer accounts printed by `make seed`.

## Services (dev)

| Service | URL / port | Notes |
| --- | --- | --- |
| Web app | http://localhost:3000 | TanStack Start (SSR + server functions) |
| Mailpit UI | http://localhost:8025 | all dev email lands here (SMTP :1025) |
| SeaweedFS master UI | http://localhost:9333 | S3 API on :8333 |
| SeaweedFS filer UI | http://localhost:8888 | browse uploaded files |
| Drizzle Studio | `make studio` | database browser |

## Plans

Phase-1 plans live in [`plans/phase1`](plans/phase1/plan-1.md) — start with plan-1.
