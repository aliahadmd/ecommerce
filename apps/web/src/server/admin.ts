import { createServerFn } from "@tanstack/react-start"
import { db, schema, and, desc, eq, gte, inArray, sql } from "@ecommerce/db"
import { AppError, guard, requireRole } from "./session"

export const getAdminStats = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    await requireRole("super_admin")
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)

    const [users, sellers, products, orders30d, revenue] = await Promise.all([
      db.$count(schema.users),
      db.$count(schema.users, eq(schema.users.role, "seller")),
      db.$count(schema.products, eq(schema.products.status, "active")),
      db.$count(schema.orders, gte(schema.orders.createdAt, thirtyDaysAgo)),
      db
        .select({ total: sql<number>`coalesce(sum(total_cents),0)::int` })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.paymentStatus, "paid"),
            gte(schema.orders.createdAt, thirtyDaysAgo),
          ),
        ),
    ])

    const ordersPerDay = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', created_at), 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.orders)
      .where(gte(schema.orders.createdAt, thirtyDaysAgo))
      .groupBy(sql`date_trunc('day', created_at)`)
      .orderBy(sql`date_trunc('day', created_at)`)

    const ordersByStatus = await db
      .select({ status: schema.orders.status, count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .groupBy(schema.orders.status)

    const topCategories = await db
      .select({
        name: schema.categories.name,
        sold: sql<number>`coalesce(sum(${schema.orderItems.quantity}),0)::int`,
      })
      .from(schema.orderItems)
      .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .groupBy(schema.categories.name)
      .orderBy(desc(sql`coalesce(sum(${schema.orderItems.quantity}),0)`))
      .limit(5)

    return {
      users,
      sellers,
      products,
      orders30d,
      revenueCents: revenue[0]?.total ?? 0,
      ordersPerDay,
      ordersByStatus,
      topCategories,
    }
  }),
)

export const adminListUsers = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    await requireRole("super_admin")
    return db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        banned: schema.users.banned,
        emailVerified: schema.users.emailVerified,
        createdAt: schema.users.createdAt,
        shopCount: sql<number>`(select count(*)::int from shops s where s.owner_id = "users"."id")`,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt))
      .limit(100)
  }),
)

export const adminSetUserRole = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { userId?: unknown; role?: unknown }
    const userId = String(raw.userId ?? "")
    const role = String(raw.role ?? "")
    if (!userId) throw new AppError("INVALID", "userId required")
    if (!["super_admin", "seller", "buyer"].includes(role)) {
      throw new AppError("INVALID", "Invalid role")
    }
    return { userId, role: role as "super_admin" | "seller" | "buyer" }
  })
  .handler(({ data }) =>
    guard(async () => {
      const admin = await requireRole("super_admin")
      if (admin.id === data.userId && data.role !== "super_admin") {
        throw new AppError("INVALID", "You cannot demote yourself")
      }
      if (data.role === "seller") {
        const [shop] = await db
          .select({ id: schema.shops.id })
          .from(schema.shops)
          .where(eq(schema.shops.ownerId, data.userId))
          .limit(1)
        if (!shop) {
          throw new AppError("INVALID", "This user has no shop — they must onboard as a seller first")
        }
      }
      await db
        .update(schema.users)
        .set({ role: data.role })
        .where(eq(schema.users.id, data.userId))
      return { ok: true }
    }),
  )

export const adminSetUserBanned = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as { userId?: unknown; banned?: unknown; reason?: unknown }
    const userId = String(raw.userId ?? "")
    const banned = Boolean(raw.banned)
    if (!userId) throw new AppError("INVALID", "userId required")
    if (banned && !String(raw.reason ?? "").trim()) {
      throw new AppError("INVALID", "A ban reason is required")
    }
    return {
      userId,
      banned,
      reason: raw.reason ? String(raw.reason).slice(0, 300) : null,
    }
  })
  .handler(({ data }) =>
    guard(async () => {
      const admin = await requireRole("super_admin")
      if (admin.id === data.userId) {
        throw new AppError("INVALID", "You cannot ban yourself")
      }
      await db
        .update(schema.users)
        .set({
          banned: data.banned,
          banReason: data.banned ? data.reason : null,
        })
        .where(eq(schema.users.id, data.userId))
      return { ok: true }
    }),
  )

export const getSellerStats = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireRole("seller", "super_admin")
    const [shop] = await db
      .select()
      .from(schema.shops)
      .where(eq(schema.shops.ownerId, user.id))
      .limit(1)
    if (!shop) throw new AppError("FORBIDDEN", "Create your shop first")
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)

    const [activeProducts, pendingOrders, unpaidDelivered, revenue] = await Promise.all([
      db.$count(
        schema.products,
        and(eq(schema.products.shopId, shop.id), eq(schema.products.status, "active")),
      ),
      db
        .select({ count: sql<number>`count(distinct ${schema.orders.id})::int` })
        .from(schema.orders)
        .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
        .where(
          and(
            eq(schema.orderItems.shopId, shop.id),
            inArray(schema.orders.status, ["pending", "confirmed"]),
          ),
        ),
      db
        .select({ count: sql<number>`count(distinct ${schema.orders.id})::int` })
        .from(schema.orders)
        .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
        .where(
          and(
            eq(schema.orderItems.shopId, shop.id),
            eq(schema.orders.status, "delivered"),
            eq(schema.orders.paymentStatus, "unpaid"),
          ),
        ),
      db
        .select({ total: sql<number>`coalesce(sum(${schema.orderItems.totalCents}),0)::int` })
        .from(schema.orderItems)
        .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
        .where(
          and(
            eq(schema.orderItems.shopId, shop.id),
            eq(schema.orders.paymentStatus, "paid"),
            gte(schema.orders.createdAt, thirtyDaysAgo),
          ),
        ),
    ])

    const ordersPerDay = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', "orders"."created_at"), 'YYYY-MM-DD')`,
        count: sql<number>`count(distinct "orders"."id")::int`,
      })
      .from(schema.orders)
      .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
      .where(
        and(eq(schema.orderItems.shopId, shop.id), gte(schema.orders.createdAt, thirtyDaysAgo)),
      )
      .groupBy(sql`date_trunc('day', "orders"."created_at")`)
      .orderBy(sql`date_trunc('day', "orders"."created_at")`)

    const recentOrders = await db
      .selectDistinctOn([schema.orders.createdAt, schema.orders.id], {
        id: schema.orders.id,
        orderNumber: schema.orders.orderNumber,
        status: schema.orders.status,
        paymentStatus: schema.orders.paymentStatus,
        totalCents: schema.orders.totalCents,
        currency: schema.orders.currency,
        createdAt: schema.orders.createdAt,
      })
      .from(schema.orders)
      .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
      .where(eq(schema.orderItems.shopId, shop.id))
      .orderBy(desc(schema.orders.createdAt), schema.orders.id)
      .limit(8)

    return {
      shopName: shop.name,
      activeProducts,
      pendingOrders: pendingOrders[0]?.count ?? 0,
      unpaidDelivered: unpaidDelivered[0]?.count ?? 0,
      revenueCents: revenue[0]?.total ?? 0,
      ordersPerDay,
      recentOrders,
    }
  }),
)

