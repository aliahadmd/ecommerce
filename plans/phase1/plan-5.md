# Plan 5 — Authentication, Authorization & RBAC

**Status:** Done
**Depends on:** plan-4 (schema), plan-3 (Mailpit running)
**Estimated effort:** 1.5 days

---

## Goal

Full email + password auth with **email verification through Mailpit**, session cookies, the three roles (`super_admin` / `seller` / `buyer`), server-side role enforcement in every protected server function, and the auth pages. Uses **better-auth** with the Drizzle adapter from plan-4's schema.

## `packages/auth`

**Server instance (`src/server.ts`)**

```ts
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: ["http://localhost:3000"],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) =>
      mailer.sendVerificationEmail(user.email, url),   // packages/email → Mailpit
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "buyer", input: false },
    },
  },
  plugins: [admin()],          // better-auth admin plugin: ban/unban, role mgmt, impersonation
  rateLimit: { enabled: true, window: 60, max: 10 },  // built-in; DB-backed storage
});
```

**Client helper (`src/client.ts`)** — `createAuthClient()` bound to `/api/auth`; re-export typed hooks (`useSession`) for `apps/web`.

**Route mounting** — better-auth's handler mounted in TanStack Start at `/api/auth/*` (server route file under `apps/web/src/routes/api/auth/[...all].ts` calling `auth.handler`).

**Guard helpers (`apps/web/src/server/guards.ts`)** — used at the top of every protected server function:

```ts
requireUser()                    // 401 if no session
requireRole("seller" | "admin")  // 403 unless role matches (super_admin passes everything)
requireNotBanned()               // folded into requireUser
```

Client-side `beforeLoad` helpers (`apps/web/src/lib/route-guards.ts`): redirect to `/login?redirect=<path>` when unauthenticated; to `/` with a toast when the role doesn't match. UX only — the server functions above are the real gate.

## Flows

1. **Register** → account created with role `buyer`, verification email sent. Mailpit shows it at http://localhost:8025 (docs tell devs to open this — no real SMTP in dev).
2. **Verify** → click link → `autoSignInAfterVerification` logs the user in.
3. **Login / logout** → session cookie (7 days, secure attributes per better-auth defaults; relaxed cookie settings only if dev on http requires it).
4. **Forgot / reset password** → email with reset link (same Mailpit path).
5. **Become a seller** (`/seller/onboarding`): email-verified user creates their shop (name, description) → transaction creates the `shops` row and updates `users.role = 'seller'` → session user is refreshed (better-auth `updateUser`/re-issue) so the new role takes effect without re-login.
6. **Ban/unban** — admin plugin APIs, surfaced in plan-9's user management UI; banned users fail `requireUser` with a clear 403.

## Pages (all shadcn; TanStack Form + Zod for every form)

| Route | Access | Contents |
| --- | --- | --- |
| `/login` | guest | email+password, link to register; honors `?redirect` |
| `/register` | guest | name, email, password, confirm; "check Mailpit at :8025" hint on success |
| `/verify-email` | guest | token handling, resend button |
| `/forgot-password`, `/reset-password` | guest | reset flow |
| `/account` | user | profile basics (name, avatar), addresses CRUD (plan-8 uses them), sign out |
| `/seller/onboarding` | verified buyer | create shop → becomes seller |

Demo credentials for reviewers live in README (from seed: admin@dev.local, seller/buyer accounts).

## Security notes

- Role is **never** accepted from client input (`input: false` in better-auth config).
- Every server function re-checks session+role server-side, even if the route is guarded client-side.
- Rate limiting: better-auth's built-in limiter covers login/register/reset; app-level Redis limiter for uploads/AI comes in plans 6/10.
- No secrets in cookies beyond better-auth's signed session token; `BETTER_AUTH_SECRET` from env only.

## Acceptance criteria

- [ ] Register → Mailpit shows the verification mail → clicking verifies and signs in.
- [ ] Unverified users cannot log in (clear error).
- [ ] Role matrix enforced server-side: buyer gets 403 from any seller/admin server function; seller blocked from admin; super_admin passes all.
- [ ] `/admin/*` and `/seller/*` redirect unauthenticated users to `/login?redirect=…`.
- [ ] Creating a shop flips role to seller and works without re-login.
- [ ] Ban test: admin-banned user's next request fails with 403.
- [ ] Sessions survive app restart (Postgres-backed sessions, plan-4 schema).
- [ ] 11 rapid failed logins get rate-limited.

## Explicitly not in this plan

OAuth/social login, two-factor, organization plugin (phase 2+); user-management UI (plan-9).

---

## As-built note (2026-09-25)

better-auth 1.7.5 with drizzle adapter, uuid ids, admin plugin (`defaultRole: buyer`, `adminRoles: [super_admin]` with access-control role definition). Deltas: email templates are plain HTML functions via nodemailer instead of react-email (fewer moving parts); TanStack Start server routes use `createFileRoute(...).server.handlers` (the createServerFileRoute API no longer exists); DropdownMenuLabel must be wrapped in DropdownMenuGroup for Base UI.
