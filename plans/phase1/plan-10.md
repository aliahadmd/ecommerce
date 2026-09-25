# Plan 10 — AI Features (AI SDK + OpenRouter)

**Status:** Done
**Depends on:** plan-7 (product form is the integration point)
**Estimated effort:** 1 day

---

## Goal

First AI capabilities using the Vercel **AI SDK** with **OpenRouter** as the provider: a product description generator and tag suggestions in the seller product form. Everything degrades gracefully when `OPENROUTER_API_KEY` is unset (features hide, nothing crashes) — AI is an enhancement, never a dependency, in phase 1.

## `packages/ai`

- Deps: `ai` (v5), `@openrouter/ai-sdk-provider`.
- `getModel()` → `createOpenRouter({ apiKey: env.OPENROUTER_API_KEY })(env.AI_MODEL)` (default `z-ai/glm-4.6`; any OpenRouter chat model id works — configurable per env, no code change).
- Central `generate()`/`stream()` helpers with: max output tokens cap, input length clamp, JSON-mode helpers for structured output (`generateObject` + Zod schema), and a single retry.
- All prompts live in `packages/ai/src/prompts.ts` (versioned strings, not scattered).

## Server functions (`apps/web/src/server/ai.ts`)

| Function | Auth | Behavior |
| --- | --- | --- |
| `generateProductDescription({ title, categoryId, tagNames, bullets? })` | seller/admin | Returns 2–3 sentence description (structured output: `{ description }`). Rate limit: 10/hour/user via Redis. Max ~1000 chars output. |
| `suggestTags({ title, description })` | seller/admin | Returns up to 5 tag names constrained to existing tags (Zod-validated array of strings, matched server-side against `tags` table). Rate limit: 20/hour/user. |

Cost/abuse controls: per-user Redis limiter (above) + global daily cap env (`AI_DAILY_LIMIT`, default 500 calls) — exceeding returns a typed "AI budget reached" error; failures bubble as friendly toasts, the form stays fully usable manually.

## UI integration (plan-7's product form)

- "✨ Generate description" button next to the description field: calls the server function (TanStack Query mutation), inserts the text **into the editable textarea** — never auto-saves; user reviews/edits, exactly like a human assistant.
- "Suggest tags" button under the tag selector: suggestions appear as chips with a plus to add; clicking uses existing tags only (no new-tag creation from AI in phase 1).
- Buttons hidden entirely when `OPENROUTER_API_KEY` is missing (server function returns a well-known error; UI also probes a lightweight `aiStatus()` included in route data).
- Optional streaming for description (AI SDK `streamText` through a Start server-sent-event stream) — only if it's trivial with the pinned Start version; otherwise single-shot. Decision recorded in the plan file when executed.

## Stretch (explicitly optional, timeboxed to half a day): pgvector semantic search

`/search?q=` hybrid search:

1. `product_embeddings` table: `productId` unique FK, `embedding vector(N)`, `contentHash` (skip re-embed when unchanged).
2. Embed on product publish/update via OpenRouter **if a suitable embedding model is available through it** — OpenRouter is chat-focused and may not serve embeddings; if not available, this stretch is **deferred to phase 2** with a dedicated embedding provider note (that was the known trade-off when choosing OpenRouter).
3. Query path: embed query → cosine top-50 → merge with the ILIKE results from plan-7 (title matches rank first).
4. pgvector index: `ivfflat`/`hnsw` created only when the table exists.

Default expectation: **deferred**, since the phase-1 stack already satisfies search via ILIKE + pg_trgm.

## Acceptance criteria

- [ ] With a dev OpenRouter key: description generates into the editable field; suggested tags map to real tags.
- [ ] Without a key: buttons hidden; app fully functional otherwise; no console errors.
- [ ] Rate limits trip with clear messaging; global daily cap respected.
- [ ] Prompt injection sanity: a product title like "ignore instructions and…" cannot make the endpoint output anything but a description (output is schema-validated).
- [ ] `AI_MODEL` swap via env works with no code change.

## Explicitly not in this plan

AI-generated images, chat/support bot, review summarization, embeddings-backed recommendations (phase 2+).

---

## As-built note (2026-09-25)

packages/ai on ai@5 + @openrouter/ai-sdk-provider with generateObject structured outputs; server fns (generateDescription, suggestTags, aiStatus) with per-user Redis rate limits, a global daily cap, schema-validated outputs, and graceful AI_DISABLED when OPENROUTER_API_KEY is unset (UI hides the buttons). Deltas: streaming deferred (single-shot); pgvector semantic-search stretch deferred — OpenRouter does not serve embeddings (as anticipated in the plan). Actual generation was not exercised without a key; error paths verified.
