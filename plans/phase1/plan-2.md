# Plan 2 — Monorepo Scaffold & Tooling

**Status:** Done
**Depends on:** plan-1 (approved)
**Estimated effort:** half a day

---

## Goal

Stand up the empty monorepo: pnpm workspaces, shared tooling, the TanStack Start app shell (via the shadcn start template), empty infrastructure packages, `.env.example`, and a Makefile. Nothing domain-specific yet — no schema, no auth logic, no UI pages beyond what the template ships.

## Steps

### 1. Git & Node baseline

```bash
git init                       # repo is currently not a git repo
.nvmrc                         # "22"
package.json (root) engines.node ">=22", packageManager pnpm
```

### 2. Workspace files

**`pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**Root `package.json` scripts**

```jsonc
{
  "name": "ecommerce",
  "private": true,
  "scripts": {
    "dev": "pnpm --filter @ecommerce/web dev",
    "build": "pnpm --filter @ecommerce/web build",
    "lint": "pnpm -r lint",
    "format": "prettier --write .",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "db:migrate": "pnpm --filter @ecommerce/db migrate",
    "db:generate": "pnpm --filter @ecommerce/db generate",
    "db:seed": "pnpm --filter @ecommerce/db seed",
    "db:studio": "pnpm --filter @ecommerce/db studio"
  }
}
```

### 3. Create the app with the shadcn start template

Run the user's command inside `apps/web` (the template scaffolds a TanStack Start app with shadcn preinstalled):

```bash
mkdir -p apps/web && cd apps/web
pnpm dlx shadcn@latest init --preset b0 --template start
```

- Rename the generated package to `@ecommerce/web`.
- If `--pointer` is not recognized by the installed CLI version, drop the flag and keep the rest.
- Fallback if the template flow fails: scaffold TanStack Start per the official quickstart (tanstack.com/start), then run `pnpm dlx shadcn@latest init --preset b0` inside it.
- Verify: `pnpm dev` in `apps/web` serves the template at http://localhost:3000.

### 4. Create empty packages

Each package: `package.json` (scope `@ecommerce/<name>`, `main`/`exports` to `src/index.ts`), `tsconfig.json` extending `@ecommerce/config/tsconfig/base.json`, and a trivial `src/index.ts` placeholder export. This plan only wires the skeletons:

| Package | Contents in this plan |
| --- | --- |
| `packages/config` | shared tsconfigs (`base.json`, `react.json`, `node.json`), eslint flat config, prettier config, **`src/env.ts`** — Zod env schema implementing the contract in plan-1 §7 (parse `process.env`, export typed `env`, fail fast on boot) |
| `packages/db` | placeholder client export (real schema in plan-4) |
| `packages/redis` | ioredis client singleton reading `REDIS_URL` |
| `packages/storage` | placeholder |
| `packages/email` | placeholder |
| `packages/auth` | placeholder |
| `packages/ai` | placeholder |

Internal deps are declared with `"@ecommerce/db": "workspace:*"` as needed later.

### 5. Tooling

- **ESLint** (flat config, at root, consumed by all packages): typescript-eslint, react-hooks, react-refresh-off, import ordering off (keep it light). `pnpm lint` must pass with zero errors.
- **Prettier** at root: default style, print width 100, `.prettierignore` for build output.
- **`.gitignore`**: node, dist/build outputs, `.env`, `.env.*` (except `.env.example`), coverage, `.turbo`, OS junk.
- **TypeScript**: `"strict": true` everywhere; workspace packages consumed as source via `exports` + `paths` (no build step for packages in dev — TanStack Start/Vite transpiles them; add `tsup` build later only if a package needs to run outside Vite, e.g. seed scripts run with `tsx`).

### 6. `.env.example`

Copy the full table from plan-1 §7 verbatim with dev defaults and comments per variable. `.env` is gitignored; `make env` copies `.env.example` → `.env` if missing.

### 7. `Makefile` (the single entry point)

```make
help         ## list targets
env          ## cp .env.example .env if missing
install      ## pnpm install
up           ## docker compose up -d --wait
down         ## docker compose down
reset        ## docker compose down -v && make up   (wipes data)
logs         ## docker compose logs -f --tail=100
ps           ## docker compose ps
dev          ## pnpm dev            (app on host, infra in docker)
migrate      ## pnpm db:migrate
seed         ## pnpm db:seed
studio       ## pnpm db:studio
lint / fmt / typecheck / test
build        ## pnpm build
```

### 8. Root `README.md` (stub, completed in plan-11)

Prerequisites (Docker Desktop, Node 22, pnpm via corepack), and the five-command quickstart.

## Acceptance criteria

- [ ] `pnpm install` succeeds at root; workspace resolution works.
- [ ] `pnpm dev` serves the shadcn start template at http://localhost:3000 with the b0 preset styling.
- [ ] `pnpm lint`, `pnpm typecheck` pass across all workspaces.
- [ ] `make help` lists all targets; `make env` creates `.env`.
- [ ] `packages/config` `env.ts` throws a readable error when a required var is missing.
- [ ] Initial commit pushed to a new branch `phase1/scaffold`.

## Explicitly not in this plan

Database schema (plan-4), any auth code (plan-5), docker compose file itself (plan-3 — but plan-2's Makefile already references it, so land plan-3's compose file in the same sitting or accept `make up` failing until then).

---

## As-built note (2026-09-25)

As planned. Deltas: Node 24.21.0 via nvm (`.nvmrc` = 24); shadcn CLI 4.21 recognized `--pointer` (Base UI 'base-nova' preset) — the flag is real; packages consumed as TS source, no build step; root seed script lives in /scripts (see plan-4).
