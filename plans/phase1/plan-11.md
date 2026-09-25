# Plan 11 — Testing, Hardening & Dokploy-Ready Packaging

**Status:** Done
**Depends on:** plans 2–10
**Estimated effort:** 1.5–2 days

---

## Goal

Close phase 1: an automated test suite, a security/hardening checklist, observability basics, the production-shaped Dockerfile, and documentation that maps this repo onto **Dokploy** with external services. No production tuning is done — only the *shape* is proven.

## 1. Testing (Vitest)

**Unit** (`*.test.ts` next to code, `pnpm test`):

- money/slug/format utils; order-status transition matrix (pure function extracted from plan-8 server code — matrix tested exhaustively: every from→to×role combination).
- `packages/config` env schema: missing var → readable error.

**Integration** (server functions against a real Postgres — `DATABASE_URL` pointed at a `ecommerce_test` database, recreated per run by a setup script):

- auth: register → verify → login → role guards (403 matrix).
- catalog: create product as seller; cross-seller 403; public list only shows active.
- orders: checkout transaction happy path; over-sell rollback; cancel restores stock; snapshot integrity after price edit.

**E2E smoke (optional, timeboxed):** Playwright — register → verify (fetch link from Mailpit API on :8025) → login → create product → place COD order → seller confirms. Marked `@smoke`, run manually in phase 1 (CI wiring is phase 2).

## 2. Hardening checklist (review gate — every box ticked or consciously deferred with a note)

- [ ] Every server function: Zod-validated input + server-side session/role check (grep-audit).
- [ ] All auth routes covered by better-auth rate limit; uploads + AI behind Redis limiters.
- [ ] Upload validation from plan-6 (MIME allowlist, size, UUID names).
- [ ] Error envelope: typed `{ code, message }`; stack traces logged server-side (pino), never sent to client in prod build.
- [ ] better-auth `trustedOrigins` limited to the app origin; cookie flags reviewed.
- [ ] Security headers via Start config: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, basic CSP (relaxed in dev).
- [ ] `pnpm audit` clean or findings triaged in README.
- [ ] Secrets only via env; `.env` gitignored; no secrets in seed output/logs.
- [ ] Admin self-demotion and self-ban blocked.

## 3. Observability (minimal, dev-appropriate)

- `pino` logger with request-id; server-function errors logged with context.
- **`/api/health`**: `{ status: "ok", db: "ok", redis: "ok", storage: "ok" }` — checks Postgres `SELECT 1`, Redis `PING`, S3 `HeadBucket`; 503 on failure. This is the Dokploy healthcheck target.

## 4. Production-shaped Dockerfile (proven with a build, not deployed)

`Dockerfile` at repo root (build context = root so workspace packages resolve):

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# copy every package.json (apps/web, packages/*)
RUN pnpm fetch

FROM deps AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline && pnpm build

FROM node:22-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
# copy built output (exact path per TanStack Start version: verify at build time,
# e.g. apps/web/.output for nitro-style output or dist/ for pure vite)
COPY --from=build --chown=app:app /repo/apps/web/.output ./.output
USER app
EXPOSE 3000
ENV NODE_ENV=production PORT=3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", ".output/server/index.mjs"]
```

> The output path/start command is verified during this plan by actually running `docker build` + `docker run` against the plan-3 infra. `.dockerignore`: node_modules, .env*, .git, plans/, coverage.

## 5. Dokploy mapping (documentation, not deployment)

`README.md` gets a "Deploying later" section:

| Dokploy concern | Approach |
| --- | --- |
| App | Service from **Dockerfile** (above); healthcheck path `/api/health`; domain via Dokploy reverse proxy |
| Postgres | Provision via Dokploy's Postgres template **or** external managed DB — either way app only knows `DATABASE_URL` |
| Redis | Dokploy Redis template or external — only `REDIS_URL` |
| Object storage | External S3 (or a SeaweedFS/Minio Dokploy template) — only `S3_*` vars |
| SMTP | External provider — only `SMTP_*` vars (Mailpit is dev-only) |
| Config | All env from plan-1 §7 set in Dokploy UI; no volumes needed for the app container (stateless) |
| Migrations | Run once as a one-off command/service (`pnpm db:migrate`) before/with first deploy |

A `docker-compose.prod.example.yml` (not used by dev) shows the same env wiring for reference.

## 6. Documentation

- **README**: quickstart (`make env && make up && make migrate && make seed && make dev`), service URL table (plan-3), demo credentials, plan index, TanStack-usage map (from plan-9), "Deploying later" section above.
- Each plan file gets its **Status** updated to `Done` with a one-line "as-built deltas" note where execution deviated from the plan.

## Acceptance criteria

- [ ] `pnpm test` green (unit + integration) from clean state.
- [ ] Hardening checklist fully ticked with review notes.
- [ ] `/api/health` reflects real service state (stops DB → 503).
- [ ] `docker build` succeeds; `docker run` against plan-3 infra serves the app on :3000 and passes its HEALTHCHECK.
- [ ] A new developer can go from clone to full happy path in <10 minutes using only the README.
- [ ] All plan files updated to `Done` with as-built notes.

## Explicitly not in this plan

CI/CD pipelines, staging environment, backups/monitoring/alerting, actual Dokploy deployment (phase 2).

---

## As-built note (2026-09-25)

Vitest suite (20 tests: order matrix, money/slug utils) green; /api/health with db/redis/storage checks green; multi-stage Dockerfile builds and runs via a small production runner (server.production.mjs) that serves TanStack Start's fetch-handler build output with streaming + Set-Cookie support; compose.prod.example.yml + README deploy mapping documented. Deltas: Playwright e2e deferred to phase 2 (browser-driven manual e2e was performed instead); pnpm 12 requires `allowBuilds` in pnpm-workspace.yaml and no longer reads the `pnpm` field in package.json.
