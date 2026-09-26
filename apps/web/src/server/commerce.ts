import { createServerFn } from "@tanstack/react-start"
import { db, schema, and, desc, eq, gte, inArray, sql } from "@ecommerce/db"
import { formatMoney, getEnv } from "@ecommerce/config"
import {
  sendOrderCancelledEmail,
  sendOrderPlacedEmail,
  sendOrderStatusEmail,
  sendPaymentReceivedEmail,
} from "@ecommerce/email"
import type { OrderEmailItem } from "@ecommerce/email"
import { recomputeProductAggregates } from "./internals"
import { AppError, guard, requireRole, requireUser } from "./session"
import { canCancel, canMarkPaid, canTransition } from "@/lib/order-machine"
import type { OrderStatus } from "@/lib/order-machine"

// ─── Cart ───────────────────────────────────────────────────────────────────

async function ensureCart(userId: string) {
  const [existing] = await db
    .select()
    .from(schema.carts)
    .where(eq(schema.carts.userId, userId))
    .limit(1)
  if (existing) return existing
  const [created] = await db.insert(schema.carts).values({ userId }).returning()
  return created
}

const cartItemColumns = {
  itemId: schema.cartItems.id,
  productId: schema.products.id,
  variantId: schema.cartItems.variantId,
  // effective values: variant overrides product when present
  title: sql<string>`concat(${schema.products.title}, case when ${schema.productVariants.title} is null then '' else concat(' — ', ${schema.productVariants.title}) end)`,
  slug: schema.products.slug,
  priceCents: sql<number>`coalesce(${schema.productVariants.priceCents}, ${schema.products.priceCents})`,
  currency: schema.products.currency,
  stock: sql<number>`coalesce(${schema.productVariants.stock}, ${schema.products.stock})`,
  quantity: schema.cartItems.quantity,
  imageUrl: sql<string | null>`(
    select coalesce(
      (select pi.url from product_images pi where pi.id = ${schema.productVariants.imageId}),
      (select pi.url from product_images pi where pi.product_id = ${schema.products.id} order by pi.sort_order asc limit 1)
    )
  )`,
  shopName: schema.shops.name,
  shopId: schema.shops.id,
  shopOwnerId: schema.shops.ownerId,
}

async function loadCartItems(cartId: string) {
  return db
    .select(cartItemColumns)
    .from(schema.cartItems)
    .innerJoin(
      schema.products,
      eq(schema.cartItems.productId, schema.products.id)
    )
    .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
    .leftJoin(schema.productVariants, eq(schema.cartItems.variantId, schema.productVariants.id))
    .where(eq(schema.cartItems.cartId, cartId))
    .orderBy(desc(schema.cartItems.createdAt))
}

export const getCart = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireUser()
    const cart = await ensureCart(user.id)
    const items = await loadCartItems(cart.id)
    const subtotalCents = items.reduce(
      (sum, i) => sum + i.priceCents * i.quantity,
      0
    )
    return {
      items,
      subtotalCents,
      count: items.reduce((n, i) => n + i.quantity, 0),
    }
  })
)

const cartTarget = createServerFn({ method: "POST" }).validator(
  (input: unknown) => {
    const raw = input as {
      productId?: unknown
      variantId?: unknown
      quantity?: unknown
    }
    const productId = String(raw.productId ?? "")
    const variantId = raw.variantId ? String(raw.variantId) : null
    const quantity = Number(raw.quantity ?? 1)
    if (!productId) throw new AppError("INVALID", "productId required")
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new AppError("INVALID", "Quantity must be 1–999")
    }
    return { productId, variantId, quantity }
  }
)

export const addToCart = cartTarget.handler(({ data }) =>
  guard(async () => {
    const user = await requireUser()
    const [product] = await db
      .select({
        id: schema.products.id,
        stock: schema.products.stock,
        status: schema.products.status,
        shopStatus: schema.shops.status,
        title: schema.products.title,
      })
      .from(schema.products)
      .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
      .where(eq(schema.products.id, data.productId))
      .limit(1)
    if (
      !product ||
      product.status !== "active" ||
      product.shopStatus !== "active"
    ) {
      throw new AppError("NOT_FOUND", "This product is not available")
    }

    const cart = await ensureCart(user.id)
    const [existing] = await db
      .select()
      .from(schema.cartItems)
      .where(
        and(
          eq(schema.cartItems.cartId, cart.id),
          eq(schema.cartItems.productId, product.id)
        )
      )
      .limit(1)
    const requested = (existing?.quantity ?? 0) + data.quantity
    if (requested > product.stock) {
      throw new AppError(
        "OUT_OF_STOCK",
        `Only ${product.stock} left of "${product.title}"`
      )
    }
    if (existing) {
      await db
        .update(schema.cartItems)
        .set({ quantity: requested })
        .where(eq(schema.cartItems.id, existing.id))
    } else {
      await db
        .insert(schema.cartItems)
        .values({
          cartId: cart.id,
          productId: product.id,
          variantId: data.variantId,
          quantity: data.quantity,
        })
    }
    const items = await loadCartItems(cart.id)
    return { count: items.reduce((n, i) => n + i.quantity, 0) }
  })
)

const cartItemTarget = createServerFn({ method: "POST" }).validator(
  (input: unknown) => {
    const raw = input as { itemId?: unknown; quantity?: unknown }
    const itemId = String(raw.itemId ?? "")
    if (!itemId) throw new AppError("INVALID", "itemId required")
    const quantity =
      raw.quantity === undefined ? undefined : Number(raw.quantity)
    if (
      quantity !== undefined &&
      (!Number.isInteger(quantity) || quantity < 0 || quantity > 999)
    ) {
      throw new AppError("INVALID", "Invalid quantity")
    }
    return { itemId, quantity }
  }
)

async function ownCartItem(userId: string, itemId: string) {
  const [row] = await db
    .select({ id: schema.cartItems.id, cartId: schema.cartItems.cartId })
    .from(schema.cartItems)
    .innerJoin(schema.carts, eq(schema.cartItems.cartId, schema.carts.id))
    .where(
      and(eq(schema.cartItems.id, itemId), eq(schema.carts.userId, userId))
    )
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Cart item not found")
  return row
}

export const updateCartItem = cartItemTarget.handler(({ data }) =>
  guard(async () => {
    const user = await requireUser()
    const item = await ownCartItem(user.id, data.itemId)
    if (data.quantity === 0) {
      await db.delete(schema.cartItems).where(eq(schema.cartItems.id, item.id))
      return { removed: true }
    }
    if (data.quantity !== undefined) {
      const [product] = await db
        .select({ stock: schema.products.stock, title: schema.products.title })
        .from(schema.cartItems)
        .innerJoin(
          schema.products,
          eq(schema.cartItems.productId, schema.products.id)
        )
        .where(eq(schema.cartItems.id, item.id))
        .limit(1)
      if (product && data.quantity > product.stock) {
        throw new AppError(
          "OUT_OF_STOCK",
          `Only ${product.stock} left of "${product.title}"`
        )
      }
      await db
        .update(schema.cartItems)
        .set({ quantity: data.quantity })
        .where(eq(schema.cartItems.id, item.id))
    }
    const items = await loadCartItems(item.cartId)
    return { count: items.reduce((n, i) => n + i.quantity, 0) }
  })
)

export const removeCartItem = cartItemTarget.handler(({ data }) =>
  guard(async () => {
    const user = await requireUser()
    const item = await ownCartItem(user.id, data.itemId)
    await db.delete(schema.cartItems).where(eq(schema.cartItems.id, item.id))
    const items = await loadCartItems(item.cartId)
    return { removed: true, count: items.reduce((n, i) => n + i.quantity, 0) }
  })
)

// ─── Addresses ──────────────────────────────────────────────────────────────

const addressInput = (input: unknown) => {
  const raw = input as Record<string, unknown>
  const str = (k: string, max = 120) => {
    const v = String(raw[k] ?? "").trim()
    if (!v) throw new AppError("INVALID", `${k} is required`)
    return v.slice(0, max)
  }
  return {
    label: raw.label ? String(raw.label).slice(0, 40) : null,
    fullName: str("fullName", 80),
    phone: str("phone", 30),
    line1: str("line1"),
    line2: raw.line2 ? String(raw.line2).slice(0, 120) : null,
    city: str("city", 80),
    state: raw.state ? String(raw.state).slice(0, 80) : null,
    postalCode: raw.postalCode ? String(raw.postalCode).slice(0, 20) : null,
    country: str("country", 2).toUpperCase(),
  }
}

export const listAddresses = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireUser()
    return db
      .select()
      .from(schema.addresses)
      .where(eq(schema.addresses.userId, user.id))
      .orderBy(
        desc(schema.addresses.isDefault),
        desc(schema.addresses.createdAt)
      )
  })
)

export const createAddress = createServerFn({ method: "POST" })
  .validator(addressInput)
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const hasDefault = await db.$count(
        schema.addresses,
        eq(schema.addresses.userId, user.id)
      )
      const [row] = await db
        .insert(schema.addresses)
        .values({ ...data, userId: user.id, isDefault: hasDefault === 0 })
        .returning()
      return row
    })
  )

export const setDefaultAddress = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown })?.id ?? "")
    if (!id) throw new AppError("INVALID", "id required")
    return { id }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      await db.transaction(async (tx) => {
        await tx
          .update(schema.addresses)
          .set({ isDefault: false })
          .where(eq(schema.addresses.userId, user.id))
        await tx
          .update(schema.addresses)
          .set({ isDefault: true })
          .where(
            and(
              eq(schema.addresses.id, data.id),
              eq(schema.addresses.userId, user.id)
            )
          )
      })
      return { ok: true }
    })
  )

export const deleteAddress = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown })?.id ?? "")
    if (!id) throw new AppError("INVALID", "id required")
    return { id }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      await db
        .delete(schema.addresses)
        .where(
          and(
            eq(schema.addresses.id, data.id),
            eq(schema.addresses.userId, user.id)
          )
        )
      return { deleted: true }
    })
  )

// ─── Checkout ───────────────────────────────────────────────────────────────

function orderNumber(): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `ORD-${ymd}-${rand}`
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  )
}

export const placeOrder = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const addressId = String(
      (input as { addressId?: unknown })?.addressId ?? ""
    )
    if (!addressId) throw new AppError("INVALID", "Choose a delivery address")
    return { addressId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const [address] = await db
        .select()
        .from(schema.addresses)
        .where(
          and(
            eq(schema.addresses.id, data.addressId),
            eq(schema.addresses.userId, user.id)
          )
        )
        .limit(1)
      if (!address) throw new AppError("NOT_FOUND", "Address not found")

      const cart = await ensureCart(user.id)
      const items = await loadCartItems(cart.id)
      if (items.length === 0)
        throw new AppError("EMPTY_CART", "Your cart is empty")

      const env = getEnv()
      const shippingFeeCents = env.SHIPPING_FEE_CENTS
      const currency = env.CURRENCY

      const result = await db.transaction(async (tx) => {
        let subtotalCents = 0
        const orderItems: (typeof schema.orderItems.$inferInsert)[] = []

        // Re-validate availability at purchase time: a product may have been
        // archived, or its shop suspended, after the cart was filled.
        const availability = await tx
          .select({
            productId: schema.products.id,
            status: schema.products.status,
            shopStatus: schema.shops.status,
            shopName: schema.shops.name,
          })
          .from(schema.products)
          .innerJoin(schema.shops, eq(schema.products.shopId, schema.shops.id))
          .where(
            inArray(
              schema.products.id,
              items.map((i) => i.productId)
            )
          )
        const byProduct = new Map(availability.map((a) => [a.productId, a]))
        for (const item of items) {
          const a = byProduct.get(item.productId)
          if (!a || a.status !== "active") {
            throw new AppError(
              "UNAVAILABLE",
              `"${item.title}" is no longer available — remove it from your cart`
            )
          }
          if (a.shopStatus !== "active") {
            throw new AppError(
              "UNAVAILABLE",
              `Shop "${a.shopName}" is currently unavailable — remove its items from your cart`
            )
          }
        }

        const variantProductIds = new Set<string>()
        for (const item of items) {
          if (item.variantId) {
            // Variant-level decrement (same row-level oversell guard)
            const updated = await tx
              .update(schema.productVariants)
              .set({ stock: sql`${schema.productVariants.stock} - ${item.quantity}` })
              .where(
                and(
                  eq(schema.productVariants.id, item.variantId),
                  eq(schema.productVariants.status, "active"),
                  gte(schema.productVariants.stock, item.quantity)
                )
              )
              .returning({ id: schema.productVariants.id })
            if (updated.length === 0) {
              throw new AppError(
                "OUT_OF_STOCK",
                `"${item.title}" only has ${item.stock} left — adjust your cart`
              )
            }
            const [prod] = await tx
              .select({ productId: schema.productVariants.productId })
              .from(schema.productVariants)
              .where(eq(schema.productVariants.id, item.variantId))
              .limit(1)
            if (prod) variantProductIds.add(prod.productId)
          } else {
            // Legacy product-level decrement
            const updated = await tx
              .update(schema.products)
              .set({ stock: sql`${schema.products.stock} - ${item.quantity}` })
              .where(
                and(
                  eq(schema.products.id, item.productId),
                  eq(schema.products.status, "active"),
                  gte(schema.products.stock, item.quantity)
                )
              )
              .returning({ id: schema.products.id })
            if (updated.length === 0) {
              throw new AppError(
                "OUT_OF_STOCK",
                `"${item.title}" only has ${item.stock} left — adjust your cart`
              )
            }
          }
          const totalCents = item.priceCents * item.quantity
          subtotalCents += totalCents
          orderItems.push({
            orderId: "",
            productId: item.productId,
            variantId: item.variantId,
            shopId: item.shopId,
            title: item.title,
            variantTitle: item.variantId
              ? item.title.slice(item.title.indexOf(" — ") + 3) || null
              : null,
            slug: item.slug,
            imageUrl: item.imageUrl,
            unitPriceCents: item.priceCents,
            quantity: item.quantity,
            totalCents,
          })
        }

        // Retry on the (rare) order-number collision
        let order!: typeof schema.orders.$inferSelect
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            ;[order] = await tx
              .insert(schema.orders)
              .values({
                orderNumber: orderNumber(),
                buyerId: user.id,
                status: "pending",
                paymentMethod: "cod",
                paymentStatus: "unpaid",
                subtotalCents,
                shippingFeeCents,
                totalCents: subtotalCents + shippingFeeCents,
                currency,
                shipName: address.fullName,
                shipPhone: address.phone,
                shipLine1: address.line1,
                shipLine2: address.line2,
                shipCity: address.city,
                shipState: address.state,
                shipPostalCode: address.postalCode,
                shipCountry: address.country,
              })
              .returning()
            break
          } catch (err) {
            if (isUniqueViolation(err) && attempt === 2) {
              throw new AppError(
                "INTERNAL",
                "Could not allocate an order number — please retry"
              )
            }
            if (!isUniqueViolation(err)) throw err
          }
        }

        await tx
          .insert(schema.orderItems)
          .values(orderItems.map((i) => ({ ...i, orderId: order.id })))
        await tx
          .delete(schema.cartItems)
          .where(eq(schema.cartItems.cartId, cart.id))
        // keep product price/stock aggregates honest after variant stock moves
        for (const pid of variantProductIds) {
          await recomputeProductAggregates(tx, pid)
        }
        return order
      })

      // Fire-and-forget emails (post-commit)
      const shopIds = [...new Set(items.map((i) => i.shopId))]
      const shops = shopIds.length
        ? await db
            .select({ id: schema.shops.id, ownerId: schema.shops.ownerId })
            .from(schema.shops)
            .where(inArray(schema.shops.id, shopIds))
        : []
      const orderItemsFull = await db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, result.id))
      const emailItems: OrderEmailItem[] = orderItemsFull.map((i) => ({
        title: i.title,
        quantity: i.quantity,
        totalFormatted: formatMoney(i.totalCents, result.currency),
      }))
      const addressText = `${result.shipLine1}${result.shipLine2 ? ", " + result.shipLine2 : ""}, ${result.shipCity} ${result.shipPostalCode ?? ""}, ${result.shipCountry}`
      const totalFormatted = formatMoney(result.totalCents, result.currency)
      void sendOrderPlacedEmail(user.email, {
        orderNumber: result.orderNumber,
        items: emailItems,
        totalFormatted,
        shipAddress: addressText,
      })
      for (const shop of shops) {
        const [owner] = await db
          .select({ email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, shop.ownerId))
          .limit(1)
        if (owner) {
          void sendOrderPlacedEmail(owner.email, {
            orderNumber: result.orderNumber,
            items: emailItems,
            totalFormatted,
            shipAddress: addressText,
          })
        }
      }

      return {
        id: result.id,
        orderNumber: result.orderNumber,
        totalCents: result.totalCents,
      }
    })
  )

// ─── Orders: buyer view ─────────────────────────────────────────────────────

const orderListColumns = {
  id: schema.orders.id,
  orderNumber: schema.orders.orderNumber,
  status: schema.orders.status,
  paymentStatus: schema.orders.paymentStatus,
  totalCents: schema.orders.totalCents,
  currency: schema.orders.currency,
  createdAt: schema.orders.createdAt,
  itemCount: sql<number>`(select coalesce(sum(oi.quantity),0)::int from order_items oi where oi.order_id = "orders"."id")`,
}

export const listMyOrders = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireUser()
    return db
      .select(orderListColumns)
      .from(schema.orders)
      .where(eq(schema.orders.buyerId, user.id))
      .orderBy(desc(schema.orders.createdAt))
      .limit(50)
  })
)

export const getMyOrder = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown })?.id ?? "")
    if (!id) throw new AppError("INVALID", "id required")
    return { id }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const [order] = await db
        .select()
        .from(schema.orders)
        .where(
          and(eq(schema.orders.id, data.id), eq(schema.orders.buyerId, user.id))
        )
        .limit(1)
      if (!order) throw new AppError("NOT_FOUND", "Order not found")
      const items = await db
        .select({
          id: schema.orderItems.id,
          title: schema.orderItems.title,
          slug: schema.orderItems.slug,
          imageUrl: schema.orderItems.imageUrl,
          unitPriceCents: schema.orderItems.unitPriceCents,
          quantity: schema.orderItems.quantity,
          totalCents: schema.orderItems.totalCents,
        })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, order.id))
      return { order, items }
    })
  )

// ─── Orders: seller & admin ─────────────────────────────────────────────────

async function sellerShopId(userId: string): Promise<string> {
  const [shop] = await db
    .select({ id: schema.shops.id })
    .from(schema.shops)
    .where(eq(schema.shops.ownerId, userId))
    .limit(1)
  if (!shop) throw new AppError("FORBIDDEN", "Create your shop first")
  return shop.id
}

export const listShopOrders = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireRole("seller", "super_admin")
    const shopId = await sellerShopId(user.id)
    const rows = await db
      .selectDistinctOn([schema.orders.createdAt, schema.orders.id], {
        id: schema.orders.id,
        orderNumber: schema.orders.orderNumber,
        status: schema.orders.status,
        paymentStatus: schema.orders.paymentStatus,
        totalCents: schema.orders.totalCents,
        currency: schema.orders.currency,
        createdAt: schema.orders.createdAt,
        buyerName: schema.users.name,
      })
      .from(schema.orders)
      .innerJoin(
        schema.orderItems,
        eq(schema.orderItems.orderId, schema.orders.id)
      )
      .innerJoin(schema.users, eq(schema.orders.buyerId, schema.users.id))
      .where(eq(schema.orderItems.shopId, shopId))
      .orderBy(desc(schema.orders.createdAt), schema.orders.id)
      .limit(100)
    return rows
  })
)

export const listAllOrders = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    await requireRole("super_admin")
    return db
      .select({
        id: schema.orders.id,
        orderNumber: schema.orders.orderNumber,
        status: schema.orders.status,
        paymentStatus: schema.orders.paymentStatus,
        totalCents: schema.orders.totalCents,
        currency: schema.orders.currency,
        createdAt: schema.orders.createdAt,
        buyerName: schema.users.name,
      })
      .from(schema.orders)
      .innerJoin(schema.users, eq(schema.orders.buyerId, schema.users.id))
      .orderBy(desc(schema.orders.createdAt))
      .limit(100)
  })
)

export const getOrderDetail = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown })?.id ?? "")
    if (!id) throw new AppError("INVALID", "id required")
    return { id }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, data.id))
        .limit(1)
      if (!order) throw new AppError("NOT_FOUND", "Order not found")

      let items = await db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, order.id))
      const shopIds = [...new Set(items.map((i) => i.shopId))]

      if (user.role === "seller") {
        // sellers see only the lines that belong to their shop
        const [shop] = await db
          .select({ id: schema.shops.id })
          .from(schema.shops)
          .where(eq(schema.shops.ownerId, user.id))
          .limit(1)
        items = shop ? items.filter((i) => i.shopId === shop.id) : []
        if (items.length === 0)
          throw new AppError("FORBIDDEN", "Not your order")
      } else if (user.role === "buyer" && order.buyerId !== user.id) {
        throw new AppError("FORBIDDEN", "Not your order")
      }

      return { order, items, shopIds, viewer: { id: user.id, role: user.role } }
    })
  )

// ─── Order actions ──────────────────────────────────────────────────────────

async function loadOrderForAction(
  orderId: string,
  viewer: { id: string; role: string }
) {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1)
  if (!order) throw new AppError("NOT_FOUND", "Order not found")
  const items = await db
    .select({ shopId: schema.orderItems.shopId })
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
  const shopIds = [...new Set(items.map((i) => i.shopId))]

  let viewerShopId: string | undefined
  if (viewer.role === "seller") {
    const [shop] = await db
      .select({ id: schema.shops.id })
      .from(schema.shops)
      .where(eq(schema.shops.ownerId, viewer.id))
      .limit(1)
    if (!shop || !shopIds.includes(shop.id)) {
      throw new AppError("FORBIDDEN", "This order does not contain your items")
    }
    viewerShopId = shop.id
  }
  return { order, shopIds, viewerShopId }
}

async function orderEmails(
  orderId: string,
  kind: "status" | "paid" | "cancelled",
  extra?: { status?: OrderStatus; reason?: string | null }
) {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1)
  if (!order) return
  const [buyer] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, order.buyerId))
    .limit(1)
  if (!buyer) return
  const totalFormatted = formatMoney(order.totalCents, order.currency)
  if (kind === "status" && extra?.status) {
    void sendOrderStatusEmail(buyer.email, order.orderNumber, extra.status)
  } else if (kind === "paid") {
    void sendPaymentReceivedEmail(
      buyer.email,
      order.orderNumber,
      totalFormatted
    )
  } else if (kind === "cancelled") {
    void sendOrderCancelledEmail(
      buyer.email,
      order.orderNumber,
      extra?.reason ?? null
    )
  }
}

export const updateOrderStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = input as {
      orderId?: unknown
      status?: unknown
      reason?: unknown
    }
    const orderId = String(raw.orderId ?? "")
    const status = String(raw.status ?? "") as OrderStatus
    if (!orderId) throw new AppError("INVALID", "orderId required")
    if (
      !["pending", "confirmed", "shipped", "delivered", "cancelled"].includes(
        status
      )
    ) {
      throw new AppError("INVALID", "Invalid status")
    }
    return {
      orderId,
      status,
      reason: raw.reason ? String(raw.reason).slice(0, 300) : null,
    }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const { order, shopIds, viewerShopId } = await loadOrderForAction(
        data.orderId,
        user
      )
      const viewer = { id: user.id, role: user.role, shopId: viewerShopId }

      if (data.status === "cancelled") {
        if (
          !canCancel(
            { status: order.status, buyerId: order.buyerId, shopIds },
            viewer
          )
        ) {
          throw new AppError(
            "FORBIDDEN",
            "You cannot cancel this order at its current stage"
          )
        }
        if (!data.reason)
          throw new AppError("INVALID", "A cancellation reason is required")
        await db.transaction(async (tx) => {
          await tx
            .update(schema.orders)
            .set({
              status: "cancelled",
              paymentStatus: "void",
              cancelReason: data.reason,
            })
            .where(eq(schema.orders.id, order.id))
          const items = await tx
            .select({
              productId: schema.orderItems.productId,
              variantId: schema.orderItems.variantId,
              quantity: schema.orderItems.quantity,
            })
            .from(schema.orderItems)
            .where(eq(schema.orderItems.orderId, order.id))
          const variantProductIds = new Set<string>()
          for (const item of items) {
            if (item.variantId) {
              // Variant-level restore + aggregate recompute
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
        })
        void orderEmails(order.id, "cancelled", { reason: data.reason })
        return { status: "cancelled" as const }
      }

      if (!canTransition(order.status, data.status)) {
        throw new AppError(
          "INVALID",
          `Cannot move an order from ${order.status} to ${data.status}`
        )
      }
      await db
        .update(schema.orders)
        .set({ status: data.status })
        .where(eq(schema.orders.id, order.id))
      void orderEmails(order.id, "status", { status: data.status })
      return { status: data.status }
    })
  )

export const markOrderPaid = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const orderId = String((input as { orderId?: unknown })?.orderId ?? "")
    if (!orderId) throw new AppError("INVALID", "orderId required")
    return { orderId }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const { order, viewerShopId } = await loadOrderForAction(
        data.orderId,
        user
      )
      if (
        !canMarkPaid(order.status, order.paymentStatus, {
          id: user.id,
          role: user.role,
          shopId: viewerShopId,
        })
      ) {
        throw new AppError(
          "INVALID",
          "Payment can be marked after delivery (cash collected by hand)"
        )
      }
      await db
        .update(schema.orders)
        .set({ paymentStatus: "paid" })
        .where(eq(schema.orders.id, order.id))
      void orderEmails(order.id, "paid")
      return { paymentStatus: "paid" as const }
    })
  )
