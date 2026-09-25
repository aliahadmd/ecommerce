import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { auth } from "@ecommerce/auth"
import { ok, fail, type Result } from "@ecommerce/config"

export type Role = "super_admin" | "seller" | "buyer"

export type AppUser = {
  id: string
  name: string
  email: string
  role: Role
  emailVerified: boolean
  image: string | null
}

/** Error used internally inside server-function handlers. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Session lookup that works during SSR (reads the incoming request cookies).
 * Returns null when unauthenticated or banned.
 */
export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppUser | null> => {
    const request = getRequest()
    if (!request) return null
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) return null
    const u = session.user as unknown as {
      id: string
      name: string
      email: string
      role: Role
      emailVerified: boolean
      image: string | null
      banned: boolean
    }
    if (u.banned) return null
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      emailVerified: u.emailVerified,
      image: u.image ?? null,
    }
  },
)

export async function requireUser(): Promise<AppUser> {
  const user = await getSession()
  if (!user) throw new AppError("UNAUTHORIZED", "Please sign in to continue")
  return user
}

export async function requireRole(...roles: Role[]): Promise<AppUser> {
  const user = await requireUser()
  if (!roles.includes(user.role)) {
    throw new AppError("FORBIDDEN", "You do not have permission to do that")
  }
  return user
}

/**
 * Wrap a server-function handler body: converts AppError into a serializable
 * Result; unexpected errors are logged (server-side only) and masked.
 */
export async function guard<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await run())
  } catch (err) {
    if (err instanceof AppError) return fail(err.code, err.message)
    console.error("[server fn] unexpected error:", err)
    return fail("INTERNAL", "Something went wrong. Please try again.")
  }
}
