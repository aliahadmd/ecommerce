import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { auth } from "@ecommerce/auth"
import { db, schema, and, eq, sql, desc } from "@ecommerce/db"

/**
 * Client-safe cart badge lookup. Deliberately separate from server/commerce
 * so the header (rendered on every page) does not pull the whole server
 * graph into the client bundle.
 */
export const getCart = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest()
  if (!request) return { ok: true as const, data: { count: 0 } }
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return { ok: true as const, data: { count: 0 } }
  const [cart] = await db
    .select({ id: schema.carts.id })
    .from(schema.carts)
    .where(eq(schema.carts.userId, session.user.id))
    .limit(1)
  if (!cart) return { ok: true as const, data: { count: 0 } }
  const items = await db
    .select({ quantity: schema.cartItems.quantity })
    .from(schema.cartItems)
    .where(eq(schema.cartItems.cartId, cart.id))
    .orderBy(desc(schema.cartItems.createdAt))
  void sql
  void and
  return { ok: true as const, data: { count: items.reduce((n, i) => n + i.quantity, 0) } }
})
