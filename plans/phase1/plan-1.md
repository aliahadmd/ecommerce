# Plan 1 — Phase 1 Overview & Architecture

**Status:** Draft (approved by default unless changed)
**Depends on:** nothing — this is the map for plans 2–11
**Date:** 2026-09-25

---

## 1. What Phase 1 delivers

A working **multi-vendor marketplace MVP** (AliExpress/Taobao-style) that runs entirely from Docker on a developer machine, structured so it can later be deployed to **Dokploy** with external managed services:

1. **Auth & roles** — email + password sign-up with email verification (Mailpit), three roles: `super_admin`, `seller`, `buyer`.
2. **Catalog** — categories, tags, products with images (uploaded to SeaweedFS), browsable public storefront.
3. **Orders** — cart → checkout → **cash on delivery** (no payment provider). Seller fulfills; cash is collected by hand on delivery and marked as paid.
4. **Infra in Docker, as separate containers** — Postgres 17 + pgvector, Redis 7, SeaweedFS (S3-compatible), Mailpit (SMTP). All app configuration is env-driven so these can be swapped for external credentials later without code changes.
5. **Dokploy-ready shape** — single app Dockerfile, `/api/health` endpoint, 12-factor config.

**Out of scope for phase 1:** online payment gateways, reviews/ratings, coupons, background job workers, semantic search (stretch only), mobile apps, production hardening beyond plan-11's checklist.

---

## 2. Roles — important clarification

The goal statement lists *"Buyer: can list products for selling"* and *"Seller: can buy products"*. This reads as a swap (and contradicts "The seller can buy the product" later in the same text). Phase 1 assumes the conventional meaning:

| Role | Capabilities |
| --- | --- |
| `super_admin` | Manages everything: users & roles, categories/tags, moderate any product, view/cancel any order, dashboards, settings. |
| `seller` | Owns one shop; creates products with images; fulfills orders for own shop (confirm → ship → deliver → mark paid). **Can also buy like any user** (Taobao model). |
| `buyer` | Browses, carts, checks out with cash-on-delivery, tracks/cancels own orders, manages addresses. |

Rules:

- New sign-ups are `buyer` by default; **every authenticated user can buy**.
- A user becomes `seller` through shop onboarding (creating their first shop) — plan-5.
- Only `super_admin` can change roles directly (plan-9 user management) or suspend accounts.
- Authorization is enforced **server-side inside every server function**. Client-side route guards are UX only, never the security boundary.

---

## 3. Order & payment model (phase 1)

No payment provider. Home delivery, pay the courier/seller by hand:

```
pending → confirmed → shipped → delivered ──(cash collected)──▶ payment_status = paid
   └────────────── cancelled (buyer/seller/admin, only while pending/confirmed)
```

- `orders.payment_method = 'cod'` (cash on delivery), `orders.payment_status`: `unpaid | paid | void`.
- "Mark paid" is a manual button for seller/admin when cash is received.
- Stock decrements at checkout inside a DB transaction; cancellation restores stock.

---

## 4. Architecture

```
                    ┌─────────────────────────────────────────────┐
   Browser  ──────▶ │  apps/web — TanStack Start (SSR + Vite)     │
                    │  • file routes (public, /account, /seller,  │
                    │    /admin) with beforeLoad guards           │
                    │  • server functions = the API layer         │
                    └───────┬─────────┬─────────┬─────────┬───────┘
                            │         │         │         │
              ┌─────────────┘         │         │         └──────────────┐
      @ecommerce/auth        @ecommerce/db  @ecommerce/storage   @ecommerce/email  @ecommerce/ai
      (better-auth)          (drizzle)      (S3 client)         (nodemailer)      (AI SDK + OpenRouter)
                            │         │         │                  (external API)
              ┌─────────────┴─────────┴─────────┴─────────────┐    │
              │  Docker (dev infra — separate, swappable)     │    │
              │  postgres (pgvector/pgvector:pg17) :5432      │    │
              │  redis (redis:7-alpine)             :6379     │    │
              │  seaweedfs (S3 API)                 :8333     │    │
              │  mailpit (SMTP :1025, Web UI :8025)           │    │
              └───────────────────────────────────────────────┘    ▼
                                                            OpenRouter API (external)
```

Key decisions:

- **One app** (`apps/web`) in phase 1. TanStack Start gives us SSR routes **and** the API layer via server functions — no separate backend service to deploy or reason about.
- **Validation is Zod-first**: every server function validates its input with a shared Zod schema; the same schema drives TanStack Form validation in the UI.
- **Money is stored as integer minor units** (`price_cents`), never floats. Display currency from `CURRENCY` env (default USD).
- **Dev on host, infra in Docker**: the app runs with `pnpm dev` (hot reload) and talks to `localhost` ports exposed by Docker. An optional compose profile runs the app in Docker too (plan-3) for "everything in Docker" checks.
- **Infra containers are ordinary TCP services** (not embedded/sidecar), so pointing at external Postgres/Redis/S3/SMTP later is a `.env` change only.

---

## 5. Monorepo layout (pnpm workspaces)

```
ecommerce/
├── apps/
│   └── web/                  # TanStack Start app (routes, server functions, shadcn/ui)
├── packages/
│   ├── config/               # shared tsconfig, eslint, prettier, env schema (zod)
│   ├── db/                   # drizzle schema, migrations, seed, client
│   ├── redis/                # ioredis client + helpers (rate limiting, caching)
│   ├── storage/              # SeaweedFS S3 client + upload helpers
│   ├── email/                # react-email templates + nodemailer (Mailpit SMTP)
│   ├── auth/                 # better-auth server instance + client helpers
│   └── ai/                   # AI SDK + OpenRouter provider + prompt helpers
├── docker/
│   ├── postgres/init/01-extensions.sql   # CREATE EXTENSION vector
│   └── seaweedfs/s3.json     # SeaweedFS S3 access keys
├── docker-compose.yml        # infra only (postgres, redis, seaweedfs, mailpit)
├── .env.example              # the single source of truth for env vars
├── Makefile                  # make up / dev / migrate / seed / lint / test ...
├── pnpm-workspace.yaml
└── plans/phase1/             # this folder
```

Note: shadcn/ui components live inside `apps/web` in phase 1 (only one consumer). A shared `packages/ui` can be extracted later if a second app ever appears.

---

## 6. Stack decisions & rationale

| Concern | Choice | Why |
| --- | --- | --- |
| Package manager / monorepo | pnpm workspaces | Matches the shadcn command given; no extra tooling needed at this size (Turborepo can be added later if build times demand it). |
| Full-stack framework | TanStack Start (Vite) | Requested; SSR + type-safe router + server functions in one app. |
| UI | shadcn/ui via `pnpm dlx shadcn@latest init --preset b0 --template start` | Requested; scaffold app + component system in one step. |
| Forms | TanStack Form + Zod resolvers | Requested; shared schemas with the server. |
| Tables | TanStack Table | Requested; admin/seller data grids. |
| Data fetching / cache | TanStack Query (+ Start loaders for SSR) | Requested; client-side caching and mutations. |
| Client state | TanStack Store | Requested; small global UI state (cart badge, theme). |
| Charts | `@tanstack/react-charts` (fallback: shadcn/Recharts if DX is poor) | Requested "TanStack charts" for dashboards. |
| Auth | better-auth (Drizzle adapter, admin plugin) | Email+password, email verification, sessions, roles/ban support out of the box; first-class TanStack Start support. |
| ORM / migrations | Drizzle ORM + drizzle-kit | Type-safe, simple SQL-shaped migrations, works great with pgvector. |
| Validation | Zod (v4) | Shared client/server schemas. |
| Database | Postgres 17 + pgvector (`pgvector/pgvector:pg17`) | Requested; vector ready for AI features. |
| Cache / rate limits | Redis 7 (`redis:7-alpine`) | Requested; rate limiting now, BullMQ queues in a later phase. |
| Object storage | SeaweedFS (S3 API, `chrislusf/seaweedfs`) | Requested; S3-compatible so the AWS SDK works against it and against any prod S3. |
| Email | Mailpit (`axllent/mailpit`) + nodemailer + react-email | Requested; catches all dev email with a web UI at :8025. |
| AI | Vercel AI SDK (`ai`) + `@openrouter/ai-sdk-provider` | Requested; provider-agnostic, streaming support. |
| Testing | Vitest (unit + server-function integration); Playwright smoke optional | Fast, workspace-native. |

Caveat to verify at execution time: if the installed shadcn CLI version does not recognize the `--pointer` flag, drop that flag and keep the rest of the command.

---

## 7. Environment variable contract

Single source of truth: `.env.example` at repo root (validated at boot by a Zod schema in `packages/config`). Dev defaults below.

| Variable | Dev default | Consumer |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://ecommerce:ecommerce@localhost:5432/ecommerce` | db, auth |
| `REDIS_URL` | `redis://localhost:6379` | redis |
| `S3_ENDPOINT` | `http://localhost:8333` | storage |
| `S3_PUBLIC_URL` | `http://localhost:8333/products` | storage (public image URLs) |
| `S3_BUCKET` | `products` | storage |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `ecommerce-dev` / `ecommerce-dev-secret` | storage |
| `S3_REGION` | `us-east-1` | storage |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | email |
| `EMAIL_FROM` | `Ecommerce <no-reply@dev.local>` | email |
| `BETTER_AUTH_SECRET` | long random dev string | auth |
| `BETTER_AUTH_URL` | `http://localhost:3000` | auth |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | `admin@dev.local` / set in seed | db seed |
| `OPENROUTER_API_KEY` | empty (AI features disabled if empty) | ai |
| `AI_MODEL` | `z-ai/glm-4.6` (any OpenRouter chat model id) | ai |
| `CURRENCY` | `USD` | orders |
| `PORT` | `3000` | app |

Swapping to external services later = changing only these values (hosts/credentials). No code changes. That is the entire reason infra runs as separate containers.

---

## 8. Conventions

- **IDs:** UUID (Postgres `gen_random_uuid()`). **Timestamps:** `timestamptz`, `created_at`/`updated_at` on every table.
- **Money:** integer cents columns (`*_cents`) + `currency` char(3).
- **Slugs:** kebab-case, unique where they appear in URLs (`categories.slug`, `products.slug`, `shops.slug`).
- **Enums:** Postgres enums for stable vocabularies (`user_role`, `product_status`, `order_status`, `payment_status`, `shop_status`).
- **Server functions** are the only way the client touches data. Every one: (1) Zod-validate input, (2) check session/role server-side, (3) return data or throw a typed error `{ code, message }`.
- **Route guards:** `beforeLoad` redirects unauthenticated users to `/login?redirect=…`; role-gated sections never rely on hiding UI.
- **File naming:** kebab-case files, routes mirror URLs (`apps/web/src/routes/seller/products.index.tsx`).
- **No business logic in components** — components render; server functions + small libs compute.

---

## 9. Phase 1 plan index (execution order)

| Plan | Title | Depends on |
| --- | --- | --- |
| plan-1 | Overview & architecture (this file) | — |
| plan-2 | Monorepo scaffold & tooling | plan-1 |
| plan-3 | Docker dev environment (postgres/redis/seaweedfs/mailpit) | plan-1 |
| plan-4 | Database, ORM, migrations & seeds | plan-2, plan-3 |
| plan-5 | Authentication, authorization & RBAC | plan-4 |
| plan-6 | File storage with SeaweedFS | plan-3, plan-5 |
| plan-7 | Catalog: categories, tags, products + storefront browse | plan-4, plan-5, plan-6 |
| plan-8 | Cart, checkout & COD orders | plan-7 |
| plan-9 | App shell, dashboards & polish (TanStack Table/Charts/Store) | plan-5, plan-8 |
| plan-10 | AI features (AI SDK + OpenRouter) | plan-7 |
| plan-11 | Testing, hardening & Dokploy-ready packaging | all above |

Plans 2 and 3 are independent and can run in parallel. Plans 9, 10, 11 are largely independent of each other once 7 and 8 land.

---

## 10. Phase 1 definition of done

- [ ] `make up && make migrate && make seed && make dev` runs the platform from a clean clone on a fresh machine.
- [ ] A new user can register → verify email (via Mailpit UI) → log in → browse → add to cart → check out with COD.
- [ ] A seller (upgraded via shop onboarding) can create categories/tags-less products with images and fulfill their orders.
- [ ] A super admin can manage users/roles, moderate products, see all orders, and view dashboards.
- [ ] Every protected server function enforces session + role server-side (spot-checked in review).
- [ ] All four infra services run as separate containers and are referenced only via env vars.
- [ ] `docker build` produces a runnable app image; `/api/health` reports DB/Redis status.
- [ ] Vitest suite passes; README lets a new dev run everything in under 10 minutes.

---

## 11. Future phases (preview, not committed)

Phase 2+: reviews & ratings, coupons, semantic search with pgvector + embeddings, BullMQ workers on Redis (emails, exports), seller payouts/statements, multiple images galleries & video, wishlist, notifications center, i18n, online payments (gateway abstraction behind the existing `payment_method` field), organization/multi-staff shops via better-auth organization plugin.
