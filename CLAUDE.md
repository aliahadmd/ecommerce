# Working in this repo

Multi-vendor marketplace — pnpm monorepo. `apps/web` (TanStack Start: SSR + server functions), `apps/worker` (BullMQ consumer), `packages/*` (config, db, auth, redis, storage, email, jobs, payments, ai). See README.md for setup.

## Commands

- Infra: `make up` (postgres, redis, seaweedfs, mailpit) · `make migrate` · `make seed`
- Run: `make dev` (web :3000) · `make worker` (emails/notifications — needed for queued mail)
- Gates (all must pass): `pnpm typecheck` · `pnpm lint` · `pnpm test` · `cd apps/web && npx playwright test` (needs infra + seed + dev + worker)
- Schema change: edit `packages/db/src/schema/*` → `pnpm db:generate` → review SQL → `pnpm db:migrate`. Migrations are additive; backfills live in migrations.

## Conventions

- **Server functions are the only API.** Each validates input, checks the session/role server-side (`requireUser` / `requireRole` from `server/session.ts`), and returns the `Result` envelope via `guard()`; throw `AppError(code, message)` for expected failures. Route guards are UX only.
- **Route-imported modules export only `createServerFn` values** (types are fine). Plain helpers that touch the db live in `server/*-internals.ts` / `server/order-lifecycle.ts` and are imported statically by server modules or dynamically inside handlers — never from route/components.
- **Pure rules go in `apps/web/src/lib/` with Vitest tests** (order machine, `order-status`, `order-split`, `csv`, `pagination`).
- **Drizzle helpers come from `@ecommerce/db`** — never import `drizzle-orm` directly.
- **Money is integer cents.** Display only via `formatMoney`; currency from `getEnv().CURRENCY`.
- **Money/state transitions are guarded updates** (`WHERE status = <expected>`) inside a transaction; card settlement goes only through `settleCardPayment`; cancellation only through `cancelSubOrderTx` + `runCancelEffects` (side effects post-commit).
- **Store settings** are one record (`schema.STORE_SETTINGS_KEY`) read via `readStoreSettings()`.
- **Queue job ids** go through `toJobId()` (BullMQ rejects `:`).
- **Env vars**: add to `packages/config/src/env.ts` and `.env.example` together.
- Docker dev compose must not bind-mount host files (the repo may live on a drive Docker can't share).

## Backlog

`plans/README.md` + `plans/audit-2026-09-30.md` are the active queue; `plans/phase*/` are historical records.
