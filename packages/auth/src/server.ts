import { betterAuth } from "better-auth"
import { admin, createAccessControl } from "better-auth/plugins"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access"
import { getEnv } from "@ecommerce/config"
import { db, schema } from "@ecommerce/db"
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@ecommerce/email"

// Custom RBAC vocabulary (plan-1 §2). super_admin mirrors the plugin's built-in
// admin statements; seller/buyer need no admin-plugin permissions.
const ac = createAccessControl(defaultStatements)
const superAdminRole = ac.newRole({ ...adminAc.statements })

export const auth = betterAuth({
  baseURL: getEnv().BETTER_AUTH_URL,
  trustedOrigins: ["http://localhost:3000"],
  database: drizzleAdapter(db, {
    provider: "pg",
    // Our tables use plural names (plan-4); map better-auth's models explicitly.
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
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
      await sendPasswordResetEmail(user.email, url)
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail(user.email, url)
    },
  },
  plugins: [
    admin({
      defaultRole: "buyer",
      adminRoles: ["super_admin"],
      roles: { super_admin: superAdminRole },
    }),
  ],  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
})

export type Session = typeof auth.$Infer.Session
