# Plan 4 — Database, ORM, Migrations & Seeds

**Status:** Done
**Depends on:** plan-2 (workspaces), plan-3 (postgres running)
**Estimated effort:** 1 day

---

## Goal

All of phase 1's data model in `packages/db` using Drizzle ORM: schema files, migrations, an idempotent seed, and a typed client. The schema is written to be **better-auth-compatible from day one** (plan-5 fills in the auth behavior without a second migration redesign).

## Setup in `packages/db`

- Deps: `drizzle-orm`, `postgres` (postgres-js driver), `drizzle-kit`, `tsx` (for migrate/seed scripts), `dotenv`.
- `drizzle.config.ts` loads `../../.env` (repo root) for `DATABASE_URL`.
- Scripts (`@ecommerce/db` package.json): `generate` (drizzle-kit generate), `migrate` (drizzle-kit migrate), `studio`, `seed` (tsx src/seed.ts), `drop` (drizzle-kit drop — dev only).
- Client singleton: `src/client.ts` — `drizzle(postgres(env.DATABASE_URL, { max: 10 }))`, exported as `db`. Typed schema re-exported from `src/schema/index.ts`.

## Schema layout (`src/schema/`)

```
schema/
├── auth.ts        # better-auth tables (users, sessions, accounts, verifications)
├── shops.ts
├── catalog.ts     # categories, tags, products, product_images, product_tags
├── commerce.ts    # carts, cart_items, orders, order_items
└── index.ts       # re-exports
```

### auth.ts — better-auth core tables

Field names must match what the better-auth Drizzle adapter expects (copy the reference schema from better-auth docs for the pinned version, then extend `users`):

- `users`: `id`, `name`, `email` (unique), `emailVerified`, `image`, `createdAt`, `updatedAt` — **plus our additions**: `role` (`user_role` enum, default `buyer`), `banned` bool default false, `banReason` text, `banExpires` timestamptz (these four feed better-auth's admin plugin).
- `sessions`: `id`, `userId` → users, `token` (unique), `expiresAt`, `ipAddress`, `userAgent`, `createdAt`, `updatedAt`.
- `accounts`: `id`, `userId` → users, `providerId`, `accountId`, password-hash fields per better-auth reference.
- `verifications`: `id`, `identifier`, `value`, `expiresAt`, `updatedAt`.

### catalog.ts

- `categories`: `id`, `name`, `slug` unique, `parentId` self-reference nullable (one level of nesting is enough for phase 1; tree-ready), `description`, `sortOrder` int, timestamps.
- `tags`: `id`, `name`, `slug` unique, timestamps.
- `products`: `id`, `shopId` → shops (restrict on delete), `categoryId` → categories nullable, `title`, `slug` unique, `description` text, `priceCents` int check ≥ 0, `currency` char(3) default from env, `stock` int check ≥ 0, `status` `product_status` enum (`draft | active | archived`, default `draft`), timestamps. Indexes: `(status, categoryId)`, `(shopId)`.
- `product_images`: `id`, `productId` → products cascade, `key` (S3 object key), `url`, `alt`, `sortOrder`, timestamps.
- `product_tags`: composite PK (`productId`, `tagId`).

### commerce.ts

- `carts`: `id`, `userId` unique → users, timestamps.
- `cart_items`: `id`, `cartId` cascade, `productId` restrict, `quantity` int > 0, timestamps, unique `(cartId, productId)`.
- `addresses`: `id`, `userId` cascade, `label`, `fullName`, `phone`, `line1`, `line2`, `city`, `state`, `postalCode`, `country` (char 2), `isDefault` bool, timestamps.
- `orders`: `id`, `orderNumber` unique human-readable (`ORD-YYYYMMDD-XXXX`), `buyerId` → users, `status` `order_status` enum (`pending | confirmed | shipped | delivered | cancelled`), `paymentMethod` enum (`cod`), `paymentStatus` enum (`unpaid | paid | void`), `subtotalCents`, `shippingFeeCents`, `totalCents`, `currency`, shipping snapshot columns (`shipName`, `shipPhone`, `shipLine1`, `shipLine2`, `shipCity`, `shipState`, `shipPostalCode`, `shipCountry`), `cancelReason` text nullable, timestamps. Index `(buyerId, createdAt)`.
- `order_items`: `id`, `orderId` cascade, `productId` restrict, `shopId` → shops (lets seller scope queries), snapshot columns `title`, `slug`, `imageUrl`, `unitPriceCents`, `quantity` > 0, `totalCents`. Index `(orderId)`, `(shopId)`.

> Snapshot columns are intentional: order history must not change when a product is edited later.

### shops.ts

- `shops`: `id`, `ownerId` unique → users, `name`, `slug` unique, `description`, `status` enum (`active | suspended`), timestamps.

### Reserved for later (not created now)

`product_embeddings` (`vector` column via pgvector) lands in plan-10 if the semantic-search stretch is pursued. pgvector extension is already enabled by plan-3.

## Conventions applied

- Every table: `created_at`/`updated_at` `timestamptz` with `defaultNow()`; `updated_at` maintained by drizzle `.$onUpdate()`.
- Enums as `pgEnum`s; money as `integer` cents; no floats anywhere.
- FKs: cascade for owned children (images, cart items, order items), `restrict` for references that must not vanish while referenced (product → shop, order item → product).

## Migrations

1. `pnpm db:generate` → review generated SQL by hand (drizzle-kit output is reviewed, never blindly trusted).
2. `pnpm db:migrate` against the plan-3 container.
3. Verify down-path by `make reset && make up && make migrate` from scratch.

## Seed script (`src/seed.ts`, idempotent — upsert by natural keys)

1. **Super admin** from `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` (role `super_admin`, email pre-verified).
2. Demo seller + shop ("Mega Gadgets"), demo buyer.
3. 6 categories (Electronics, Fashion, Home & Living, Beauty, Sports, Toys), 12 tags.
4. ~20 products spread across categories/shops with sane prices, stock, status `active`, plus 2 `draft` products for the seller dashboard.
5. Product images: generate tiny placeholder SVGs in-memory and upload through `@ecommerce/storage` (plan-6). If S3 is unreachable, seed products without images (UI shows a placeholder component) and print a warning — seeding must never hard-fail on storage.
6. No orders in seed (orders are created through the real checkout flow in plan-8 testing).

## Acceptance criteria

- [ ] Fresh volume → `make migrate` succeeds; `pnpm db:studio` shows all tables with correct types/relations.
- [ ] `pnpm db:seed` is safe to run twice (no duplicates, upserts by email/slug).
- [ ] `users.role` defaults to `buyer`; enums reject invalid values (checked via psql).
- [ ] FK behavior verified: deleting a product cascades its images but is blocked if referenced by an order item.
- [ ] Types flow into the app: `import { db, schema } from "@ecommerce/db"` compiles in `apps/web`.

## Explicitly not in this plan

Auth logic/flows (plan-5); any UI; triggers or advanced constraints beyond what is listed.

---

## As-built note (2026-09-25)

Schema + migrations as planned (15 tables). Deltas: better-auth session field `impersonatedBy` added; better-auth tables are mapped explicitly (user/session/account/verification → our plural tables); seed lives at /scripts/seed.ts (root) to avoid a db↔auth workspace cycle and creates users through auth.api so password hashing matches.
