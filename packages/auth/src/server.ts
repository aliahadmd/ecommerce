import { betterAuth } from "better-auth";
import { admin, createAccessControl } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";
import { getEnv } from "@ecommerce/config";
import { db, schema, eq } from "@ecommerce/db";
import { APIError } from "better-auth/api";
import { sendPasswordResetEmail, sendVerificationEmail } from "@ecommerce/email";

// Custom RBAC vocabulary (plan-1 §2). super_admin mirrors the plugin's built-in
// admin statements; seller/buyer need no admin-plugin permissions.
const ac = createAccessControl(defaultStatements);
const superAdminRole = ac.newRole({ ...adminAc.statements });

export const auth = betterAuth({
  baseURL: getEnv().BETTER_AUTH_URL,
  trustedOrigins: [getEnv().BETTER_AUTH_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    // Our tables use plural names (plan-4); map better-auth's models explicitly.
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      rateLimit: schema.rateLimits,
    },
  }),
  advanced: {
    database: {
      // Schema uses uuid PKs (plan-4 convention)
      generateId: "uuid",
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      // an SMTP hiccup must not turn into a failed request for the user
      await sendPasswordResetEmail(user.email, url).catch((err) =>
        console.error("[auth] password reset email failed:", err),
      );
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // Send the user to the app page after verification (better-auth returns
      // JSON on direct navigation without a callbackURL).
      const stripped = url.replace(/([?&])callbackURL=[^&]*/g, "$1")
      const withCallback = `${stripped}${stripped.includes("?") ? "&" : "?"}callbackURL=${encodeURIComponent("/verify-email")}`;
      await sendVerificationEmail(user.email, withCallback).catch((err) =>
        console.error("[auth] verification email failed:", err),
      );
    },
  },
  databaseHooks: {
    user: {
      create: {
        // M8: the admin "signups enabled" switch is enforced here, for every
        // sign-up path (not only hidden in the UI)
        before: async (user) => {
          const [row] = await db
            .select({ value: schema.settings.value })
            .from(schema.settings)
            .where(eq(schema.settings.key, schema.STORE_SETTINGS_KEY))
            .limit(1);
          const value = row?.value as { signupsEnabled?: unknown } | undefined;
          if (value?.signupsEnabled === false) {
            throw new APIError("FORBIDDEN", {
              message: "New sign-ups are currently closed.",
            });
          }
          return { data: user };
        },
      },
    },
  },
  plugins: [
    admin({
      defaultRole: "buyer",
      adminRoles: ["super_admin"],
      roles: { super_admin: superAdminRole },
    }),
  ],
  rateLimit: {
    enabled: true,
    // DB-backed: survives restarts and works across instances (audit fix)
    storage: "database",
    window: 60,
    max: 20,
  },
});

export type Session = typeof auth.$Infer.Session;
