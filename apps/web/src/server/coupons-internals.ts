import { db, schema, and, eq, sql } from "@ecommerce/db"
import { formatMoney, getEnv } from "@ecommerce/config"
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

/**
 * The subtotal a coupon applies to: the whole cart, or only the lines of the
 * coupon's shop when it is shop-scoped (H4 — a shop coupon must not discount
 * other sellers' items).
 */
export function couponBaseCents(
  items: { shopId: string; priceCents: number; quantity: number }[],
  couponShopId: string | null
): number {
  return items
    .filter((i) => couponShopId === null || i.shopId === couponShopId)
    .reduce((sum, i) => sum + i.priceCents * i.quantity, 0)
}

/**
 * Validate a coupon against the current cart context. Throws with reason.
 * `baseCents` is the coupon's eligible subtotal (see couponBaseCents).
 */
export async function validateUsable(
  coupon: CouponRow,
  userId: string,
  baseCents: number,
  cartShopIds: string[]
): Promise<void> {
  const now = Date.now()
  if (new Date(coupon.startsAt).getTime() > now) {
    throw new AppError("INVALID", "This coupon is not active yet")
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < now) {
    throw new AppError("INVALID", "This coupon has expired")
  }
  if (coupon.shopId && !cartShopIds.includes(coupon.shopId)) {
    throw new AppError("INVALID", "This coupon doesn't apply to the shops in your cart")
  }
  if (baseCents < coupon.minSubtotalCents) {
    throw new AppError(
      "INVALID",
      `Requires a minimum subtotal of ${formatMoney(coupon.minSubtotalCents, getEnv().CURRENCY)}`
    )
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

/**
 * Cart lines priced exactly like checkout does (variant price overrides the
 * product aggregate — M7), so the discount previewed in the cart is the one
 * charged.
 */
export async function cartContext(userId: string) {
  const [cart] = await db
    .select({ id: schema.carts.id, couponId: schema.carts.couponId })
    .from(schema.carts)
    .where(eq(schema.carts.userId, userId))
    .limit(1)
  if (!cart) return null
  const items = await db
    .select({
      priceCents: sql<number>`coalesce(${schema.productVariants.priceCents}, ${schema.products.priceCents})`,
      quantity: schema.cartItems.quantity,
      shopId: schema.products.shopId,
    })
    .from(schema.cartItems)
    .innerJoin(schema.products, eq(schema.cartItems.productId, schema.products.id))
    .leftJoin(schema.productVariants, eq(schema.cartItems.variantId, schema.productVariants.id))
    .where(eq(schema.cartItems.cartId, cart.id))
  const subtotal = couponBaseCents(items, null)
  const shopIds = [...new Set(items.map((i) => i.shopId))]
  return { cartId: cart.id, couponId: cart.couponId, items, subtotal, shopIds }
}

/**
 * Re-validate a pending cart coupon at checkout time. Returns cents off and
 * the coupon's shop scope. Throwing aborts the checkout.
 */
export async function validateCouponForCheckout(
  couponId: string,
  userId: string,
  items: { shopId: string; priceCents: number; quantity: number }[]
): Promise<{ discountCents: number; freeShipping: boolean; shopId: string | null }> {
  const [coupon] = await db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.id, couponId))
    .limit(1)
  if (!coupon) throw new AppError("INVALID", "Unknown coupon code")
  const base = couponBaseCents(items, coupon.shopId)
  const shopIds = [...new Set(items.map((i) => i.shopId))]
  await validateUsable(coupon, userId, base, shopIds)
  return {
    discountCents: computeDiscountCents(coupon.kind, coupon.value, base),
    freeShipping: coupon.kind === "free_shipping",
    shopId: coupon.shopId,
  }
}
