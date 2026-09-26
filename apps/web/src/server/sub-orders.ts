import { createServerFn } from "@tanstack/react-start"
import { db, schema, desc, eq, inArray, sql } from "@ecommerce/db"
import { AppError, guard, requireRole, requireUser } from "./session"
import { recomputeOrderStatus } from "./internals"
import { enqueueEmail, enqueueNotification } from "@ecommerce/jobs"
import { canTransition  } from "@/lib/order-machine"
import type {OrderStatus} from "@/lib/order-machine";

async function loadSubOrder(subOrderId: string) {
  const [row] = await db
    .select({
      sub: schema.subOrders,
      shopName: schema.shops.name,
      shopOwnerId: schema.shops.ownerId,
      buyerId: schema.orders.buyerId,
      orderNumber: schema.orders.orderNumber,
      orderStatus: schema.orders.status,
    })
    .from(schema.subOrders)
    .innerJoin(schema.orders, eq(schema.subOrders.orderId, schema.orders.id))
    .innerJoin(schema.shops, eq(schema.subOrders.shopId, schema.shops.id))
    .where(eq(schema.subOrders.id, subOrderId))
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Sub-order not found")
  return row
}

// ── reads ────────────────────────────────────────────────────────────────────

export const listShopSubOrders = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireRole("seller", "super_admin")
    const [shop] = await db
      .select({ id: schema.shops.id })
      .from(schema.shops)
      .where(eq(schema.shops.ownerId, user.id))
      .limit(1)
    if (!shop) return []
    const rows = await db
      .select({
        id: schema.subOrders.id,
        orderId: schema.subOrders.orderId,
        orderNumber: schema.orders.orderNumber,
        status: schema.subOrders.status,
        totalCents: schema.subOrders.totalCents,
        currency: schema.orders.currency,
        createdAt: schema.subOrders.createdAt,
        buyerName: schema.users.name,
      })
      .from(schema.subOrders)
      .innerJoin(schema.orders, eq(schema.subOrders.orderId, schema.orders.id))
      .innerJoin(schema.users, eq(schema.orders.buyerId, schema.users.id))
      .where(eq(schema.subOrders.shopId, shop.id))
      .orderBy(desc(schema.subOrders.createdAt))
      .limit(100)
    // item counts in a second query to keep the SQL simple
    const ids = rows.map((r) => r.id)
    const counts = ids.length
      ? await db
          .select({
            subOrderId: schema.orderItems.subOrderId,
            count: sql<number>`coalesce(sum(${schema.orderItems.quantity}),0)::int`,
          })
          .from(schema.orderItems)
          .where(inArray(schema.orderItems.subOrderId, ids))
          .groupBy(schema.orderItems.subOrderId)
      : []
    const countMap = new Map(counts.map((c) => [c.subOrderId, c.count]))
    return rows.map((r) => ({ ...r, itemCount: countMap.get(r.id) ?? 0 }))
  }),
)

export const getSubOrderDetail = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown })?.id ?? "")
    if (!id) throw new AppError("INVALID", "id required")
    return { id }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const row = await loadSubOrder(data.id)
      const isBuyer = row.buyerId === user.id
      const isAdmin = user.role === "super_admin"
      let isSeller = false
      if (user.role === "seller") {
        const [shop] = await db
          .select({ id: schema.shops.id })
          .from(schema.shops)
          .where(eq(schema.shops.ownerId, user.id))
          .limit(1)
        isSeller = !!shop && shop.id === row.sub.shopId
      }
      if (!isBuyer && !isAdmin && !isSeller) {
        throw new AppError("FORBIDDEN", "Not your order")
      }
      const items = await db
        .select({
          id: schema.orderItems.id,
          title: schema.orderItems.title,
          variantTitle: schema.orderItems.variantTitle,
          slug: schema.orderItems.slug,
          imageUrl: schema.orderItems.imageUrl,
          unitPriceCents: schema.orderItems.unitPriceCents,
          quantity: schema.orderItems.quantity,
          totalCents: schema.orderItems.totalCents,
        })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.subOrderId, data.id))
      return { subOrder: row.sub, shopName: row.shopName, items }
    }),
  )

// ── transitions ──────────────────────────────────────────────────────────────

export const updateSubOrderStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as {
      subOrderId?: unknown
      status?: unknown
      reason?: unknown
    }
    const subOrderId = String(raw.subOrderId ?? "")
    const status = String(raw.status ?? "") as OrderStatus
    const allowed: OrderStatus[] = [
      "pending",
      "confirmed",
      "shipped",
      "delivered",
      "cancelled",
    ]
    if (!subOrderId) throw new AppError("INVALID", "subOrderId required")
    if (!allowed.includes(status)) throw new AppError("INVALID", "Invalid status")
    return {
      subOrderId,
      status,
      reason: raw.reason ? String(raw.reason).slice(0, 300) : null,
    }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const row = await loadSubOrder(data.subOrderId)
      const viewer = {
        id: user.id,
        role: user.role,
        shopId: undefined as string | undefined,
      }
      if (user.role === "seller") {
        const [shop] = await db
          .select({ id: schema.shops.id })
          .from(schema.shops)
          .where(eq(schema.shops.ownerId, user.id))
          .limit(1)
        viewer.shopId = shop?.id
      }
      if (data.status === "cancelled") {
        const buyerOwn = row.buyerId === user.id && ["pending", "confirmed"].includes(row.sub.status)
        const sellerOwn =
          user.role === "seller" && viewer.shopId === row.sub.shopId && ["pending", "confirmed"].includes(row.sub.status)
        const admin = user.role === "super_admin" && ["pending", "confirmed"].includes(row.sub.status)
        if (!buyerOwn && !sellerOwn && !admin) {
          throw new AppError(
            "FORBIDDEN",
            "You cannot cancel this sub-order at its current stage",
          )
        }
        if (!data.reason) {
          throw new AppError("INVALID", "A cancellation reason is required")
        }
        await db.transaction(async (tx) => {
          await tx
            .update(schema.subOrders)
            .set({ status: "cancelled", cancelReason: data.reason })
            .where(eq(schema.subOrders.id, data.subOrderId))
          // restore stock for this sub-order's items
          const items = await tx
            .select({
              productId: schema.orderItems.productId,
              variantId: schema.orderItems.variantId,
              quantity: schema.orderItems.quantity,
            })
            .from(schema.orderItems)
            .where(eq(schema.orderItems.subOrderId, data.subOrderId))
          const { recomputeProductAggregates } = await import("./internals")
          const variantProductIds = new Set<string>()
          for (const item of items) {
            if (item.variantId) {
              await tx
                .update(schema.productVariants)
                .set({ stock: sql`${schema.productVariants.stock} + ${item.quantity}` })
                .where(eq(schema.productVariants.id, item.variantId))
              variantProductIds.add(item.productId)
            } else {
              await tx
                .update(schema.products)
                .set({ stock: sql`${schema.products.stock} + ${item.quantity}` })
                .where(eq(schema.products.id, item.productId))
            }
          }
          for (const pid of variantProductIds) {
            await recomputeProductAggregates(tx, pid)
          }
          await recomputeOrderStatus(tx, row.sub.orderId)
        })
        return { status: "cancelled" as const }
      }

      // forward transition (seller/admin only for fulfillment stages)
      if (user.role === "buyer") {
        throw new AppError("FORBIDDEN", "Buyers cannot advance fulfillment")
      }
      if (user.role === "seller") {
        const [shop] = await db
          .select({ id: schema.shops.id })
          .from(schema.shops)
          .where(eq(schema.shops.ownerId, user.id))
          .limit(1)
        if (!shop || shop.id !== row.sub.shopId) {
          throw new AppError("FORBIDDEN", "This sub-order is not yours")
        }
      }
      if (!canTransition(row.sub.status, data.status)) {
        throw new AppError(
          "INVALID",
          `Cannot move a sub-order from ${row.sub.status} to ${data.status}`,
        )
      }
      await db.transaction(async (tx) => {
        await tx
          .update(schema.subOrders)
          .set({ status: data.status })
          .where(eq(schema.subOrders.id, data.subOrderId))
        await recomputeOrderStatus(tx, row.sub.orderId)
        if (data.status === "delivered") {
          const { ledgerSaleForSubOrder } = await import("./payouts-internals")
          await ledgerSaleForSubOrder(tx, data.subOrderId)
        }
      })
      // worker-delivered email + in-app notification (fire-and-forget)
      const [buyer] = await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .innerJoin(schema.orders, eq(schema.orders.buyerId, schema.users.id))
        .where(eq(schema.orders.id, row.sub.orderId))
        .limit(1)
      if (buyer) {
        void enqueueEmail({
          template: "order_status",
          to: buyer.email,
          payload: { orderNumber: row.orderNumber, status: data.status },
          dedupeKey: `email:order_status:${data.subOrderId}:${data.status}`,
        })
      }
      void enqueueNotification({
        userId: row.buyerId,
        kind: "order_status",
        title: `Order ${row.orderNumber} ${data.status}`,
        body: `${row.shopName}: ${data.status}`,
        link: `/account/orders/${row.sub.orderId}`,
        dedupeKey: `notify:order_status:${data.subOrderId}:${data.status}`,
      })
      return { status: data.status }
    }),
  )
