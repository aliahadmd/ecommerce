import { createServerFn } from "@tanstack/react-start"
import { db, schema, desc, eq, sql } from "@ecommerce/db"
import { AppError, guard, requireRole, requireUser } from "./session"

/**
 * Coupon server functions. Plain helpers live in ./coupons-internals — this
 * module is imported by route files, so it must export only createServerFn
 * values to stay out of the client bundle (see internals.ts rule).
 */

type Kind = "percent" | "fixed" | "free_shipping"

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
      const { cartContext, findCouponByCode, validateUsable, computeDiscountCents } =
        await import("./coupons-internals")
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
    const { cartContext, computeDiscountCents } = await import(
      "./coupons-internals"
    )
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
