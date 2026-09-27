import { db, schema, and, eq, sql } from "@ecommerce/db"
import { AppError } from "./session"

/**
 * Server-only coupon internals. Never import from route files — plain exports
 * here reference the db and must stay out of the client graph (same rule as
 * ./internals and ./payouts-internals).
 */

export type Kind = "percent" | "fixed" | "free_shipping"

export interface CouponRow {
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
export async function validateUsable(
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

export async function findCouponByCode(code: string) {
  const [coupon] = await db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.code, code.toUpperCase()))
    .limit(1)
  if (!coupon) throw new AppError("NOT_FOUND", "Unknown coupon code")
  return coupon as CouponRow
}

export async function cartContext(userId: string) {
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

/** Settlement (called inside the placeOrder transaction). */
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
