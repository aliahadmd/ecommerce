/**
 * Pure money split for checkout (plan-2 sub-orders, plan-4 coupons).
 *
 * Integer cents only. Guarantees:
 * - per-shop discounts sum exactly to `discountCents` (largest remainder)
 * - a shop-scoped coupon's discount lands only on that shop's sub-order
 * - the flat shipping fee goes to the first shop so shipping sums exactly
 * - no shop's discount exceeds its own subtotal
 */

export interface ShopSubtotal {
  shopId: string
  subtotalCents: number
}

export interface ShopSplit {
  shopId: string
  subtotalCents: number
  shippingCents: number
  discountCents: number
  totalCents: number
}

export function splitOrder(input: {
  shops: ShopSubtotal[]
  shippingCents: number
  discountCents: number
  /** coupon scope: null = whole cart, else only this shop is discounted */
  discountShopId: string | null
}): ShopSplit[] {
  const { shops, shippingCents, discountShopId } = input
  const eligible = shops.filter(
    (s) => discountShopId === null || s.shopId === discountShopId
  )
  const base = eligible.reduce((n, s) => n + s.subtotalCents, 0)
  const discountCents = Math.max(0, Math.min(input.discountCents, base))

  // largest-remainder allocation of the discount over eligible shops
  const shares = new Map<string, number>()
  if (base > 0 && discountCents > 0) {
    const raw = eligible.map((s) => {
      const exact = (s.subtotalCents * discountCents) / base
      return { shopId: s.shopId, floor: Math.floor(exact), rem: exact - Math.floor(exact) }
    })
    let left = discountCents - raw.reduce((n, r) => n + r.floor, 0)
    raw
      .slice()
      .sort((a, b) => b.rem - a.rem)
      .forEach((r) => {
        if (left > 0) {
          r.floor += 1
          left -= 1
        }
      })
    for (const r of raw) shares.set(r.shopId, r.floor)
  }

  return shops.map((s, i) => {
    const shipping = i === 0 ? shippingCents : 0
    const discount = shares.get(s.shopId) ?? 0
    return {
      shopId: s.shopId,
      subtotalCents: s.subtotalCents,
      shippingCents: shipping,
      discountCents: discount,
      totalCents: s.subtotalCents + shipping - discount,
    }
  })
}
