# Plan 9 — App Shell, Dashboards & Polish

**Status:** Draft
**Depends on:** plan-5, plan-8 (works best after 7 too)
**Estimated effort:** 1.5–2 days

---

## Goal

Role-aware app shell, admin & seller dashboards with real charts, the user-management UI, and the UX polish pass that makes the MVP feel like a product. This is where the TanStack ecosystem pieces (Table, Charts, Store) get their dedicated showcase, on top of the per-feature usage already in plans 7–8.

## TanStack ecosystem usage map (recorded in README)

| Library | Where |
| --- | --- |
| Start / Router | all routes, type-safe params/search, `beforeLoad` guards |
| Query | every list/detail/mutation (invalidation patterns from plans 7–8) |
| Form | every form (auth, product, address, dialogs) with Zod resolvers |
| Table | seller products, seller/admin orders, admin users, admin products |
| Charts | admin + seller dashboards (`@tanstack/react-charts`; if its React DX is poor at build time, fall back to shadcn's Recharts wrapper and note the swap) |
| Store | cart badge, theme toggle, global toasts state |

## App shell

- **Public header**: logo, search box (`/products?q=`), category dropdown, cart badge (Store), account menu (login/register vs. profile/orders/`/seller`/`/admin` links by role, sign-out).
- **Role layouts**: `/admin/*` gets a sidebar layout (Dashboard, Users, Categories, Tags, Products, Orders); `/seller/*` gets its own (Dashboard, Products, Orders, Shop settings); `/account/*` a simple two-column layout. Guards from plan-5 in each section's layout `beforeLoad`.
- Footer: minimal, version + "dev build" indicator.

## Admin dashboard (`/admin`)

- Stat cards: total users, sellers, products (active), orders (30d), revenue (delivered & paid, 30d) — from `adminGetStats` server function.
- Charts: **orders per day** (last 30 days, line/area), **orders by status** (bar), **top categories by sold items** (bar).
- `/admin/users`: TanStack Table (search by email, filter by role/status) with actions: change role (dialog + confirm), ban/unban with reason, impersonation is available via better-auth admin plugin but disabled in phase 1 UI. Changing roles enforces "cannot demote yourself" guard.
- `/admin/settings` (stub): shop sign-ups open/closed toggle, store name — persisted in a small `settings` key-value table (added in this plan's migration) so admins have *something* to manage beyond users.

## Seller dashboard (`/seller`)

- Stat cards: active products, orders needing action (pending/confirmed), delivered-not-paid count, revenue (paid) 30d.
- Charts: orders per day (30d), revenue per day.
- Recent orders list linking to `/seller/orders`.
- Shop settings: edit name/description (suspended shops read-only with admin note).

## Buyer account

- `/account`: profile (name, avatar URL), addresses CRUD (already used by checkout), orders shortcut, "become a seller" CTA if not seller.

## Polish pass (checklist)

- [ ] Toasts on every mutation success/failure (sonner, consistent wording).
- [ ] Skeletons for all lists/details; route-level pending states (Start's `pendingComponent`).
- [ ] Error boundaries per layout with "try again" — no raw stack traces in UI.
- [ ] 404 page with search suggestion; 403 page explaining the role requirement.
- [ ] Dark mode via shadcn theme + Store-persisted toggle (no flash: inline script).
- [ ] Responsive: sidebar collapses to sheet; tables get card layout on small screens (TanStack Table column visibility).
- [ ] Meta/SEO: per-route `head()` with title/description; OG tags on product pages.
- [ ] Accessibility sweep: labels on all inputs, focus traps in dialogs, keyboard-navigable menus (shadcn gives most of this free — verify).
- [ ] Loading-time budget sanity: storefront list ≤ 300ms server time with seeded data (20 products; add indexes if not).

## Acceptance criteria

- [ ] Each role lands on a sensible home after login (admin → dashboard, seller → dashboard, buyer → storefront).
- [ ] Admin changes a user's role; that user's next request reflects it (session refresh handled as in plan-5).
- [ ] Ban flow: banned user's UI session terminates with a clear message.
- [ ] Charts render real seeded/clicked-through data, not mocks.
- [ ] Lighthouse quick pass on `/` and `/products` (no score gate, just no obvious failures: contrast, tap targets, meta).

## Explicitly not in this plan

Analytics/tracking, notifications center, i18n (phase 2+).
