import { createServerFn } from "@tanstack/react-start"
import { db, schema, and, asc, desc, eq, gte, inArray, isNull, sql } from "@ecommerce/db"
import { formatMoney, getEnv } from "@ecommerce/config"
import type { OrderEmailItem } from "@ecommerce/email"
import { splitOrder } from "@/lib/order-split"
import { LIST_PAGE_SIZE, pageInput } from "@/lib/pagination"
import { recomputeProductAggregates } from "./internals"
import { assertStoreOpen } from "./settings-internals"
import { AppError, guard, requireRole, requireUser } from "./session"

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
      // store currency (orders are charged in it) — not a UI "USD" fallback
      currency: getEnv().CURRENCY,
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
    await assertStoreOpen(user)
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

    // Bind the line to a sellable variant of THIS product (plan 004): a
    // variant id from another product, or an inactive one, is rejected; a
    // product with variants needs one chosen (or has exactly one).
    const activeVariants = await db
      .select({
        id: schema.productVariants.id,
        stock: schema.productVariants.stock,
      })
      .from(schema.productVariants)
      .where(
        and(
          eq(schema.productVariants.productId, product.id),
          eq(schema.productVariants.status, "active")
        )
      )
    let variant: { id: string; stock: number } | null = null
    if (data.variantId) {
      variant = activeVariants.find((v) => v.id === data.variantId) ?? null
      if (!variant) throw new AppError("INVALID", "That option is not available")
    } else if (activeVariants.length === 1) {
      variant = activeVariants[0]
    } else if (activeVariants.length > 1) {
      throw new AppError("INVALID", "Choose an option first")
    }
    const available = variant ? variant.stock : product.stock

    const cart = await ensureCart(user.id)
    // merge only into the SAME product+variant line (M1: matching on the
    // product alone bumped another variant's quantity)
    const [existing] = await db
      .select()
      .from(schema.cartItems)
      .where(
        and(
          eq(schema.cartItems.cartId, cart.id),
          eq(schema.cartItems.productId, product.id),
          variant
            ? eq(schema.cartItems.variantId, variant.id)
            : isNull(schema.cartItems.variantId)
        )
      )
      .limit(1)
    const requested = (existing?.quantity ?? 0) + data.quantity
    if (requested > available) {
      throw new AppError(
        "OUT_OF_STOCK",
        `Only ${available} left of "${product.title}"`
      )
    }
    if (existing) {
      await db
        .update(schema.cartItems)
        .set({ quantity: requested })
        .where(eq(schema.cartItems.id, existing.id))
    } else {
      await db.insert(schema.cartItems).values({
        cartId: cart.id,
        productId: product.id,
        variantId: variant?.id ?? null,
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
      // the line's real constraint: its variant's stock when it has one
      const [product] = await db
        .select({
          stock: sql<number>`coalesce(${schema.productVariants.stock}, ${schema.products.stock})`,
          title: schema.products.title,
        })
        .from(schema.cartItems)
        .innerJoin(
          schema.products,
          eq(schema.cartItems.productId, schema.products.id)
        )
        .leftJoin(
          schema.productVariants,
          eq(schema.cartItems.variantId, schema.productVariants.id)
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
      await assertStoreOpen(user)
      // release stock held by abandoned card checkouts first (H5)
      const { expireUnpaidCardOrders } = await import("./order-lifecycle")
      await expireUnpaidCardOrders().catch((err) =>
        console.error("[orders] expiry sweep failed:", err)
      )
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

      // Coupon pre-validation (plan-4): re-check window/limits/scope and
      // compute the discount. Final validation + redemption happen in-tx.
      let couponId: string | null = null
      let couponShopId: string | null = null
      let discountCents = 0
      let freeShipping = false
      {
        const [cartRow] = await db
          .select({ couponId: schema.carts.couponId })
          .from(schema.carts)
          .where(eq(schema.carts.id, cart.id))
          .limit(1)
        if (cartRow?.couponId) {
          const { validateCouponForCheckout } = await import("./coupons-internals")
          const validated = await validateCouponForCheckout(
            cartRow.couponId,
            user.id,
            items
          )
          discountCents = validated.discountCents
          freeShipping = validated.freeShipping
          couponShopId = validated.shopId
          couponId = cartRow.couponId
        }
      }

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

        // a variant-less line for a product that now has variants would
        // decrement the derived product aggregate (overwritten on the next
        // recompute → oversell); make the buyer pick an option instead
        const legacyIds = items.filter((i) => !i.variantId).map((i) => i.productId)
        if (legacyIds.length > 0) {
          const [withVariant] = await tx
            .select({ productId: schema.productVariants.productId })
            .from(schema.productVariants)
            .where(
              and(
                inArray(schema.productVariants.productId, legacyIds),
                eq(schema.productVariants.status, "active")
              )
            )
            .limit(1)
          if (withVariant) {
            const line = items.find((i) => i.productId === withVariant.productId)
            throw new AppError(
              "UNAVAILABLE",
              `"${line?.title ?? "An item"}" now comes in options — remove it and add it again`
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
                  // plan 004: never decrement another product's variant
                  eq(schema.productVariants.productId, item.productId),
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
            variantProductIds.add(item.productId)
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

        const shippingTotal = freeShipping ? 0 : shippingFeeCents

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
                shippingFeeCents: shippingTotal,
                discountCents,
                totalCents:
                  subtotalCents +
                  (freeShipping ? 0 : shippingFeeCents) -
                  discountCents,
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


        // Per-shop sub-orders (plan-2): one per distinct shop. The pure
        // splitOrder allocates shipping + discount so cents sum exactly and a
        // shop-scoped coupon only discounts its own shop (H4). Items are
        // inserted with their subOrderId stamped directly.
        const shopSubtotals = new Map<string, number>()
        for (const item of orderItems) {
          shopSubtotals.set(
            item.shopId,
            (shopSubtotals.get(item.shopId) ?? 0) + item.totalCents
          )
        }
        const split = splitOrder({
          shops: [...shopSubtotals].map(([shopId, subtotal]) => ({
            shopId,
            subtotalCents: subtotal,
          })),
          shippingCents: shippingTotal,
          discountCents,
          discountShopId: couponShopId,
        })
        const subOrderIdByShop = new Map<string, string>()
        for (const s of split) {
          const [subOrder] = await tx
            .insert(schema.subOrders)
            .values({
              orderId: order.id,
              shopId: s.shopId,
              status: "pending",
              subtotalCents: s.subtotalCents,
              shippingCents: s.shippingCents,
              discountCents: s.discountCents,
              totalCents: s.totalCents,
            })
            .returning({ id: schema.subOrders.id })
          subOrderIdByShop.set(s.shopId, subOrder.id)
        }
        await tx.insert(schema.orderItems).values(
          orderItems.map((i) => ({
            ...i,
            orderId: order.id,
            subOrderId: subOrderIdByShop.get(i.shopId) ?? null,
          }))
        )
        await tx
          .delete(schema.cartItems)
          .where(eq(schema.cartItems.cartId, cart.id))
        // the coupon is settled (or was invalid — either way it must not ride
        // along on the buyer's next cart)
        await tx
          .update(schema.carts)
          .set({ couponId: null })
          .where(eq(schema.carts.id, cart.id))
        if (couponId) {
          // lock the coupon row first: concurrent checkouts serialize here, so
          // the count checks below are exact
          const [coupon] = await tx
            .select({
              maxUses: schema.coupons.maxUses,
              maxUsesPerUser: schema.coupons.maxUsesPerUser,
            })
            .from(schema.coupons)
            .where(eq(schema.coupons.id, couponId))
            .for("update")
          const [{ mine }] = await tx
            .select({ mine: sql<number>`count(*)::int` })
            .from(schema.couponRedemptions)
            .where(
              and(
                eq(schema.couponRedemptions.couponId, couponId),
                eq(schema.couponRedemptions.userId, user.id)
              )
            )
          const [{ total }] = await tx
            .select({ total: sql<number>`count(*)::int` })
            .from(schema.couponRedemptions)
            .where(eq(schema.couponRedemptions.couponId, couponId))
          if (!coupon || mine >= coupon.maxUsesPerUser) {
            throw new AppError("INVALID", "You already used this coupon")
          }
          if (coupon.maxUses !== null && total >= coupon.maxUses) {
            throw new AppError("INVALID", "This coupon has reached its usage limit")
          }
          await tx.insert(schema.couponRedemptions).values({
            couponId,
            userId: user.id,
            orderId: order.id,
            amountCents: discountCents,
          })
        }
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
      const { enqueueEmail } = await import("@ecommerce/jobs")
      void enqueueEmail({
        template: "order_placed",
        to: user.email,
        payload: {
          orderNumber: result.orderNumber,
          items: JSON.stringify(emailItems),
          totalFormatted,
          shipAddress: addressText,
        },
        dedupeKey: `email:order_placed:${result.id}:${user.email}`,
      })
      for (const shop of shops) {
        const [owner] = await db
          .select({ email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, shop.ownerId))
          .limit(1)
        if (owner) {
          void enqueueEmail({
            template: "order_placed",
            to: owner.email,
            payload: {
              orderNumber: result.orderNumber,
              items: JSON.stringify(emailItems),
              totalFormatted,
              shipAddress: addressText,
            },
            dedupeKey: `email:order_placed:${result.id}:${owner.email}`,
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

export const listMyOrders = createServerFn({ method: "GET" })
  .validator(pageInput)
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      return db
        .select(orderListColumns)
        .from(schema.orders)
        .where(eq(schema.orders.buyerId, user.id))
        .orderBy(desc(schema.orders.createdAt))
        .limit(LIST_PAGE_SIZE)
        .offset((data.page - 1) * LIST_PAGE_SIZE)
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
      // per-seller sub-order sections (plan-2)
      const subOrders = await db
        .select({
          id: schema.subOrders.id,
          shopId: schema.subOrders.shopId,
          shopName: schema.shops.name,
          status: schema.subOrders.status,
          subtotalCents: schema.subOrders.subtotalCents,
          shippingCents: schema.subOrders.shippingCents,
          discountCents: schema.subOrders.discountCents,
          totalCents: schema.subOrders.totalCents,
          cancelReason: schema.subOrders.cancelReason,
        })
        .from(schema.subOrders)
        .innerJoin(schema.shops, eq(schema.subOrders.shopId, schema.shops.id))
        .where(eq(schema.subOrders.orderId, order.id))
        .orderBy(asc(schema.subOrders.createdAt))
      const items = await db
        .select({
          id: schema.orderItems.id,
          subOrderId: schema.orderItems.subOrderId,
          title: schema.orderItems.title,
          variantTitle: schema.orderItems.variantTitle,
          slug: schema.orderItems.slug,
          imageUrl: schema.orderItems.imageUrl,
          unitPriceCents: schema.orderItems.unitPriceCents,
          quantity: schema.orderItems.quantity,
          totalCents: schema.orderItems.totalCents,
        })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, order.id))
      const [payment] = await db
        .select({ method: schema.payments.method, state: schema.payments.state })
        .from(schema.payments)
        .where(eq(schema.payments.orderId, order.id))
        .limit(1)
      return { order, items, subOrders, payment: payment ?? null }
    })
  )

// ─── Orders: seller & admin ─────────────────────────────────────────────────

export const listAllOrders = createServerFn({ method: "GET" })
  .validator(pageInput)
  .handler(({ data }) =>
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
      .limit(LIST_PAGE_SIZE)
      .offset((data.page - 1) * LIST_PAGE_SIZE)
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
