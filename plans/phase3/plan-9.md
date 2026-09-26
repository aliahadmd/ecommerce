# Plan 9 — CI/CD & Quality Uplift

**Status:** Done
**Depends on:** plans 2–8
**Estimated effort:** 2 days

---

## Goal

Wire everything the repo already has (typecheck, Vitest, Playwright, build) into **GitHub Actions**, publish the Docker image, and close the phase-2 quality gaps (worker + payments + coupons e2e coverage; the two audit-flagged specs already exist).

## 1. GitHub Actions (`.github/workflows/ci.yml`)

**PR pipeline (`on: pull_request`):**
1. `setup`: node 24 + pnpm via `actions/setup-node` cache; install.
2. `gate`: `pnpm typecheck && pnpm lint && pnpm test`.
3. `e2e`: services container block — postgres:17 (`pgvector/pgvector:pg17` with the init SQL), redis:7, `chrislusf/seaweedfs:3.80` (s3.json via configmap-style file), mailpit; start vite dev + worker; `npx playwright test` (install chromium with dependencies).
4. `build`: `pnpm build && docker build .` (no push on PR).

**main pipeline (`on: push` to main):** everything above + `docker push` to GHCR (`${{ secrets.GITHUB_TOKEN }}`), image tagged `sha` + `latest`.

Concurrency group cancels superseded runs. Playwright artifacts (screenshots/traces) uploaded on failure.

## 2. E2E coverage additions (phase-3 flows)

- **sub-orders**: 2-seller checkout → per-seller statuses → partial cancellation (spec exists in plan-2).
- **payments**: fake-gateway card checkout → paid; simulate-failure → retry path; double webhook replay idempotency (direct API call).
- **coupons**: apply percent coupon → discount line → order shows allocated discount.
- **payouts**: after fulfillment, seller balance > 0; admin payout decrements it.
- Existing 8 specs keep passing (update order specs for sub-order UI).

## 3. Worker deployment shape

- `apps/worker` gets a minimal Dockerfile stage (same base, `CMD node dist/worker.js` after `tsc`/esbuild bundle of the worker entry).
- `docker-compose.prod.example.yml` gains a `worker` service (same image, different command, REDIS_URL shared).
- README documents `pnpm worker` for dev.

## 4. Quality uplift

- Port the phase-2 order/review e2e specs onto sub-order + payment UIs.
- Vitest: unit tests for `recomputeOrderStatus`, coupon allocation (largest remainder), ledger invariants, payment-state transitions.
- Add missing indexes surfaced by EXPLAIN on coupon_redemptions and notifications (from plan-6).

## Acceptance criteria

- [ ] A PR running red (any gate) blocks merge — verified by an intentional failing commit on a scratch branch.
- [ ] main push publishes `ghcr.io/<org>/ecommerce-web:<sha>` and the image runs against the compose infra (local pull test).
- [ ] Full CI run completes < 15 minutes.
- [ ] New e2e specs all pass in CI (not just locally).
- [ ] Flaky-test budget: 2 consecutive green runs of the e2e suite on main.

## Explicitly not in this plan

Dokploy deployment automation itself (docs stay manual), preview environments per PR, release tagging/changelogs, coverage thresholds.

---

## As-built note (2026-09-26)

CI workflow gates PRs (typecheck/lint/test) then e2e with postgres/redis/mailpit services then build; main pushes publish GHCR image.
