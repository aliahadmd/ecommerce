import { createServerFn } from "@tanstack/react-start"
import { db, schema, and, desc, eq, sql } from "@ecommerce/db"
import { AppError, guard, requireRole, requireUser } from "./session"

type Kind = "percent" | "fixed" | "free_shipping"

interface CouponRow {
  id: string
  code: string
  kind: Kind
  value: number
  shopId: string | null
  minSubtotalCents: number
  maxUses: number | null
  maxUsesPerUser: number
  startsAt: Date
  expiresAt: Date | null
}

/** Pure discount math (unit-testable): subtotal → cents off, capped. */
export function computeDiscountCents(
  kind: Kind,
  value: number,
  subtotalCents: number
): number {
  if (kind === "percent") {
    return Math.floor((subtotalCents * value) / 100)
  }
  if (kind === "fixed") {
    return Math.min(value, subtotalCents)
  }
  return 0 // free_shipping handled at shipping allocation
}

/** Validate a coupon against the current cart context. Throws with reason. */
async function validateUsable(
  coupon: CouponRow,
  userId: string,
  subtotalCents: number,
  cartShopIds: string[]
): Promise<void> {
  const now = Date.now()
  if (new Date(coupon.startsAt).getTime() > now) {
    throw new AppError("INVALID", "This coupon is not active yet")
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < now) {
    throw new AppError("INVALID", "This coupon has expired")
  }
  if (subtotalCents < coupon.minSubtotalCents) {
    throw new AppError(
      "INVALID",
      `Requires a minimum subtotal of $${(coupon.minSubtotalCents / 100).toFixed(2)}`
    )
  }
  if (coupon.shopId && !cartShopIds.includes(coupon.shopId)) {
    throw new AppError("INVALID", "This coupon doesn't apply to the shops in your cart")
  }
  const [{ uses }] = await db
    .select({ uses: sql<number>`count(*)::int` })
    .from(schema.couponRedemptions)
    .where(eq(schema.couponRedemptions.couponId, coupon.id))
  if (coupon.maxUses !== null && uses >= coupon.maxUses) {
    throw new AppError("INVALID", "This coupon has reached its usage limit")
  }
  const [{ mine }] = await db
    .select({ mine: sql<number>`count(*)::int` })
    .from(schema.couponRedemptions)
    .where(
      and(
        eq(schema.couponRedemptions.couponId, coupon.id),
        eq(schema.couponRedemptions.userId, userId)
      )
    )
  if (mine >= coupon.maxUsesPerUser) {
    throw new AppError("INVALID", "You already used this coupon")
  }
}

async function findCouponByCode(code: string) {
  const [coupon] = await db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.code, code.toUpperCase()))
    .limit(1)
  if (!coupon) throw new AppError("NOT_FOUND", "Unknown coupon code")
  return coupon as CouponRow
}

async function cartContext(userId: string) {
  const [cart] = await db
    .select({ id: schema.carts.id, couponId: schema.carts.couponId })
    .from(schema.carts)
    .where(eq(schema.carts.userId, userId))
    .limit(1)
  if (!cart) return null
  const items = await db
    .select({
      priceCents: schema.products.priceCents,
      quantity: schema.cartItems.quantity,
      shopId: schema.products.shopId,
    })
    .from(schema.cartItems)
    .innerJoin(schema.products, eq(schema.cartItems.productId, schema.products.id))
    .where(eq(schema.cartItems.cartId, cart.id))
  const subtotal = items.reduce((s, i) => s + i.priceCents * i.quantity, 0)
  const shopIds = [...new Set(items.map((i) => i.shopId))]
  return { cartId: cart.id, couponId: cart.couponId, subtotal, shopIds }
}

// ── buyer flows ──────────────────────────────────────────────────────────────

export const applyCoupon = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const code = String((input as { code?: unknown })?.code ?? "")
      .trim()
      .toUpperCase()
    if (!code) throw new AppError("INVALID", "Enter a coupon code")
    return { code }
  })
  .handler(({ data }) =>
    guard(async () => {
      const user = await requireUser()
      const ctx = await cartContext(user.id)
      if (!ctx || ctx.subtotal === 0) {
        throw new AppError("INVALID", "Add items to your cart first")
      }
      const coupon = await findCouponByCode(data.code)
      await validateUsable(coupon, user.id, ctx.subtotal, ctx.shopIds)
      const discountCents = computeDiscountCents(
        coupon.kind,
        coupon.value,
        ctx.subtotal
      )
      await db
        .update(schema.carts)
        .set({ couponId: coupon.id })
        .where(eq(schema.carts.id, ctx.cartId))
      return { code: coupon.code, discountCents }
    }),
  )

export const removeCoupon = createServerFn({ method: "POST" }).handler(() =>
  guard(async () => {
    const user = await requireUser()
    await db
      .update(schema.carts)
      .set({ couponId: null })
      .where(eq(schema.carts.userId, user.id))
    return { removed: true }
  })
)

export const getAppliedCoupon = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    const user = await requireUser()
    const ctx = await cartContext(user.id)
    if (!ctx?.couponId) return null
    const [coupon] = await db
      .select({
        code: schema.coupons.code,
        kind: schema.coupons.kind,
        value: schema.coupons.value,
      })
      .from(schema.coupons)
      .where(eq(schema.coupons.id, ctx.couponId))
      .limit(1)
    if (!coupon) return null
    return {
      code: coupon.code,
      discountCents: computeDiscountCents(coupon.kind, coupon.value, ctx.subtotal),
    }
  })
)

/**
 * Re-validate a pending cart coupon at checkout time. Returns cents off.
 * Throwing aborts the checkout transaction.
 */
export async function validateCouponForCheckout(
  couponId: string,
  userId: string,
  subtotalCents: number,
  cartShopIds: string[]
): Promise<{ discountCents: number; freeShipping: boolean }> {
  const [coupon] = await db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.id, couponId))
    .limit(1)
  if (!coupon) throw new AppError("INVALID", "Unknown coupon code")
  const now = Date.now()
  if (new Date(coupon.startsAt).getTime() > now) {
    throw new AppError("INVALID", "This coupon is not active yet")
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < now) {
    throw new AppError("INVALID", "This coupon has expired")
  }
  if (subtotalCents < coupon.minSubtotalCents) {
    throw new AppError("INVALID", `Requires a minimum subtotal of $${(coupon.minSubtotalCents / 100).toFixed(2)}`)
  }
  if (coupon.shopId && !cartShopIds.includes(coupon.shopId)) {
    throw new AppError("INVALID", "This coupon doesn't apply to the shops in your cart")
  }
  const [{ uses }] = await db
    .select({ uses: sql<number>`count(*)::int` })
    .from(schema.couponRedemptions)
    .where(eq(schema.couponRedemptions.couponId, coupon.id))
  if (coupon.maxUses !== null && uses >= coupon.maxUses) {
    throw new AppError("INVALID", "This coupon has reached its usage limit")
  }
  const [{ mine }] = await db
    .select({ mine: sql<number>`count(*)::int` })
    .from(schema.couponRedemptions)
    .where(and(eq(schema.couponRedemptions.couponId, couponId), eq(schema.couponRedemptions.userId, userId)))
  if (mine >= coupon.maxUsesPerUser) {
    throw new AppError("INVALID", "You already used this coupon")
  }
  return {
    discountCents: computeDiscountCents(coupon.kind, coupon.value, subtotalCents),
    freeShipping: coupon.kind === "free_shipping",
  }
}

// ── settlement (called inside the placeOrder transaction via import) ────────

export async function settleCoupon(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  cartId: string,
  subtotalCents: number,
  orderId: string
): Promise<{ couponId: string | null; discountCents: number }> {
  const [cart] = await tx
    .select({ couponId: schema.carts.couponId })
    .from(schema.carts)
    .where(eq(schema.carts.id, cartId))
    .limit(1)
  if (!cart?.couponId) return { couponId: null, discountCents: 0 }

  const [coupon] = await tx
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.id, cart.couponId))
    .limit(1)
  if (!coupon) return { couponId: null, discountCents: 0 }

  const discountCents = computeDiscountCents(
    coupon.kind,
    coupon.value,
    subtotalCents
  )
  await tx.insert(schema.couponRedemptions).values({
    couponId: coupon.id,
    userId,
    orderId,
    amountCents: discountCents,
  })
  await tx.update(schema.carts).set({ couponId: null }).where(eq(schema.carts.id, cartId))
  return { couponId: coupon.id, discountCents }
}

// ── admin CRUD ───────────────────────────────────────────────────────────────

export const adminListCoupons = createServerFn({ method: "GET" }).handler(() =>
  guard(async () => {
    await requireRole("super_admin")
    const rows = await db
      .select({
        id: schema.coupons.id,
        code: schema.coupons.code,
        kind: schema.coupons.kind,
        value: schema.coupons.value,
        shopName: schema.shops.name,
        minSubtotalCents: schema.coupons.minSubtotalCents,
        maxUses: schema.coupons.maxUses,
        maxUsesPerUser: schema.coupons.maxUsesPerUser,
        expiresAt: schema.coupons.expiresAt,
        uses: sql<number>`(select count(*)::int from coupon_redemptions cr where cr.coupon_id = ${schema.coupons.id})`,
      })
      .from(schema.coupons)
      .leftJoin(schema.shops, eq(schema.coupons.shopId, schema.shops.id))
      .orderBy(desc(schema.coupons.createdAt))
    return rows
  }),
)

const couponInput = (input: unknown) => {
  const raw = input as Record<string, unknown>
  const code = String(raw.code ?? "")
    .trim()
    .toUpperCase()
  const kind = String(raw.kind ?? "")
  if (!/^[A-Z0-9-]{3,30}$/.test(code)) {
    throw new AppError("INVALID", "Code: 3–30 letters/digits/dashes")
  }
  if (!["percent", "fixed", "free_shipping"].includes(kind)) {
    throw new AppError("INVALID", "Invalid discount kind")
  }
  const value = Number(raw.value ?? 0)
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError("INVALID", "Value must be a positive whole number")
  }
  if (kind === "percent" && value > 100) {
    throw new AppError("INVALID", "Percent must be 1–100")
  }
  const minSubtotalCents = Math.round(Number(raw.minSubtotalCents ?? 0))
  if (minSubtotalCents < 0) throw new AppError("INVALID", "Invalid min subtotal")
  const maxUses = raw.maxUses ? Number(raw.maxUses) : null
  const maxUsesPerUser = Math.max(1, Number(raw.maxUsesPerUser ?? 1))
  const expiresAt = raw.expiresAt ? new Date(String(raw.expiresAt)) : null
  const shopId = raw.shopId ? String(raw.shopId) : null
  return {
    code, kind: kind as Kind, value, minSubtotalCents, maxUses,
    maxUsesPerUser, expiresAt: expiresAt && !isNaN(expiresAt.getTime()) ? expiresAt : null,
    shopId,
  }
}

export const createCoupon = createServerFn({ method: "POST" })
  .validator(couponInput)
  .handler(({ data }) =>
    guard(async () => {
      const admin = await requireRole("super_admin")
      try {
        const [row] = await db
          .insert(schema.coupons)
          .values({ ...data, createdBy: admin.id })
          .returning({ id: schema.coupons.id })
        return { id: row.id }
      } catch (err) {
        if (
          typeof err === "object" && err !== null && "code" in err &&
          (err as { code?: string }).code === "23505"
        ) {
          throw new AppError("TAKEN", "That code already exists")
        }
        throw err
      }
    }),
  )

export const deleteCoupon = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown })?.id ?? "")
    if (!id) throw new AppError("INVALID", "id required")
    return { id }
  })
  .handler(({ data }) =>
    guard(async () => {
      await requireRole("super_admin")
      await db.delete(schema.coupons).where(eq(schema.coupons.id, data.id))
      return { deleted: true }
    }),
  )
