# Plan 10 — Stretch & Deferred (Parking Lot)

**Status:** Draft — intentionally not scheduled
**Depends on:** —
**Date:** 2026-09-25

---

This plan is a **parking lot**, not a work plan. Items land here when they're surfaced during phase 2 but don't fit a plan's scope. Each entry notes the blocker or the phase where it belongs.

## From phase 1 deferrals

| Item | Note |
| --- | --- |
| Per-seller sub-orders | Multi-seller orders split into independent fulfillments (seller cancels only their slice). Touches orders/checkout deeply — phase 3 with the payments work. |
| Playwright **CI** wiring | The suite itself is plan-9; GitHub Actions/Dokploy pipeline wiring is phase 3. |
| Real OpenRouter generation exercise | Needs an `OPENROUTER_API_KEY`; code paths are verified. |
| Presigned direct-to-S3 uploads | Phase 1 decision: proxy uploads; presigner dep already present. |
| Admin settings page (`/admin/settings`) | Store open/closed, shop sign-ups toggle — needs a settings table + cache. |
| Error-boundary/403 pages per section | Start defaults + redirect-based guards cover the MVP UX. |

## Surfaced during phase 2 (expected)

| Item | Note |
| --- | --- |
| CSV **import** | Plan-7 exports an import-compatible shape; import needs column mapping UI + dry-run validation. |
| Back-in-stock notifications | Needs the notification/queue layer (BullMQ on Redis) — pairs with email hardening. |
| Price-drop alerts on wishlist items | Same queue dependency. |
| Wishlists: shareable links, multi-list, account sync of recently-viewed | Client-storage only in phase 2. |
| Review photos & abuse reporting | Moderation flow grows first. |
| Q&A / product questions | New domain (question → seller/owner answers). |
| Semantic search | pgvector + a dedicated embedding provider (OpenRouter is chat-focused) — pairs with search-ranking work. |
| Product comparison table, bundles, digital products/downloads | Catalog depth beyond phase 2's scope. |
| Multi-currency display | Money is cents + `CURRENCY` env; display conversion needs rates source. |
| Seller payout statements | Needs the ledger concept — phase 3 with payments. |
| Coupons & promotions | Cart-level discounts; needs rules engine — phase 3. |

## Acceptance criteria

None — this file is documentation. Items graduate by being written into a future phase's plans with scope, schema sketches, and acceptance criteria (the phase-1/phase-2 pattern).
