# Plan 10 — Stretch & Deferred (Parking Lot)

**Status:** Draft — intentionally not scheduled
**Date:** 2026-09-26

---

Parking lot for phase-3-adjacent ideas that surfaced during planning but are out of scope. Items graduate by being written into a future phase's plans with schema sketches and acceptance criteria.

## Carried from phases 1–2

| Item | Note |
| --- | --- |
| Stripe **production** keys + go-live checklist | plan-3 ships the adapter; production onboarding is a business step |
| Sub-order-scoped **partial refunds** per line item | plan-3 ships full-order admin refunds; per-item needs a refund-items table |
| Seller-created coupons | plan-4 scopes coupons to admin; seller self-serve marketing is a phase-4 product decision |
| Automatic **scheduled payouts** (cron) | plan-5 ships admin-marked payouts; automation pairs with tax/KYC |
| Stripe **Connect** payouts to bank accounts | replaces manual payout marks; needs KYC onboarding flow |
| **Semantic search** (pgvector) | still blocked on an embedding provider through OpenRouter; hybrid ranking design sketched in phase-2 plan-10 |
| Review **Q&A** | question→seller-answer domain |
| Product **bundles** & digital downloads | catalog depth |
| **i18n** / multi-currency display | needs a rates source and locale plumbing |
| 3-D Secure edge cases, saved cards | plan-3 uses Stripe defaults |

## Surfaced during phase-3 planning

| Item | Note |
| --- | --- |
| **Notification preferences** UI (per-kind email/in-app toggles) | plan-6 ships all-in-app + email; preferences need a settings surface |
| **Websocket/push** live notifications | plan-6 polls; push pairs with a scaling review |
| **Partial item-level cancellation** inside a sub-order | plan-2 keeps cancellation at sub-order granularity |
| **Preview environments per PR** | plan-9 runs tests; ephemeral envs need a hosting decision (Dokploy API) |
| **Payment method:** wallets (Apple/Google Pay) | Stripe adapter makes this a config step; UI + testing deferred |
| **Import: image URLs column** | plan-7 imports data only |
| **Audit-log table** for admin actions (role changes, bans, payouts) | cheap to add; surfaced late to keep phase-3 scope honest |

## Acceptance criteria

None — documentation. Graduation = a real plan file with schema, functions, and acceptance criteria.
