import { describe, expect, it } from "vitest"
import { splitOrder } from "./order-split"

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe("splitOrder", () => {
  it("single shop takes everything", () => {
    const [s] = splitOrder({
      shops: [{ shopId: "a", subtotalCents: 10000 }],
      shippingCents: 500,
      discountCents: 1000,
      discountShopId: null,
    })
    expect(s).toEqual({
      shopId: "a",
      subtotalCents: 10000,
      shippingCents: 500,
      discountCents: 1000,
      totalCents: 9500,
    })
  })

  it("cart-wide discount sums exactly across shops (largest remainder)", () => {
    const split = splitOrder({
      shops: [
        { shopId: "a", subtotalCents: 3333 },
        { shopId: "b", subtotalCents: 3333 },
        { shopId: "c", subtotalCents: 3334 },
      ],
      shippingCents: 0,
      discountCents: 100,
      discountShopId: null,
    })
    expect(sum(split.map((s) => s.discountCents))).toBe(100)
    for (const s of split) expect(s.discountCents).toBeGreaterThanOrEqual(33)
  })

  it("shop-scoped discount lands only on that shop", () => {
    const split = splitOrder({
      shops: [
        { shopId: "a", subtotalCents: 5000 },
        { shopId: "b", subtotalCents: 5000 },
      ],
      shippingCents: 0,
      discountCents: 500,
      discountShopId: "b",
    })
    expect(split.find((s) => s.shopId === "a")!.discountCents).toBe(0)
    expect(split.find((s) => s.shopId === "b")!.discountCents).toBe(500)
  })

  it("discount never exceeds the eligible subtotal", () => {
    const split = splitOrder({
      shops: [{ shopId: "a", subtotalCents: 300 }],
      shippingCents: 0,
      discountCents: 1000,
      discountShopId: null,
    })
    expect(split[0].discountCents).toBe(300)
    expect(split[0].totalCents).toBe(0)
  })

  it("shipping goes to the first shop only and totals reconcile", () => {
    const split = splitOrder({
      shops: [
        { shopId: "a", subtotalCents: 1999 },
        { shopId: "b", subtotalCents: 2001 },
      ],
      shippingCents: 499,
      discountCents: 399,
      discountShopId: null,
    })
    expect(split.map((s) => s.shippingCents)).toEqual([499, 0])
    expect(sum(split.map((s) => s.totalCents))).toBe(1999 + 2001 + 499 - 399)
  })
})
