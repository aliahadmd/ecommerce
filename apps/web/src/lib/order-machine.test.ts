import { describe, expect, it } from "vitest"
import { canCancel, canMarkPaid, canTransition, ORDER_TRANSITIONS } from "./order-machine"
import type { OrderStatus } from "./order-machine"

const allStatuses: OrderStatus[] = ["pending", "confirmed", "shipped", "delivered", "cancelled"]

describe("ORDER_TRANSITIONS", () => {
  it("defines transitions for every status", () => {
    for (const s of allStatuses) expect(ORDER_TRANSITIONS[s]).toBeDefined()
  })

  it("allows only the happy path forward", () => {
    expect(canTransition("pending", "confirmed")).toBe(true)
    expect(canTransition("confirmed", "shipped")).toBe(true)
    expect(canTransition("shipped", "delivered")).toBe(true)
  })

  it("allows cancellation only from pending/confirmed", () => {
    expect(canTransition("pending", "cancelled")).toBe(true)
    expect(canTransition("confirmed", "cancelled")).toBe(true)
    expect(canTransition("shipped", "cancelled")).toBe(false)
    expect(canTransition("delivered", "cancelled")).toBe(false)
  })

  it("forbids skipping stages and going backwards", () => {
    expect(canTransition("pending", "shipped")).toBe(false)
    expect(canTransition("pending", "delivered")).toBe(false)
    expect(canTransition("delivered", "pending")).toBe(false)
    expect(canTransition("shipped", "confirmed")).toBe(false)
  })

  it("terminated states have no exits", () => {
    expect(ORDER_TRANSITIONS.delivered).toEqual([])
    expect(ORDER_TRANSITIONS.cancelled).toEqual([])
  })
})

describe("canCancel", () => {
  const order = { status: "pending" as OrderStatus, buyerId: "buyer-1", shopIds: ["shop-1"] }

  it("buyer cancels own pending order", () => {
    expect(canCancel(order, { id: "buyer-1", role: "buyer" })).toBe(true)
  })
  it("buyer cannot cancel someone else's order", () => {
    expect(canCancel(order, { id: "buyer-2", role: "buyer" })).toBe(false)
  })
  it("seller of the shop can cancel", () => {
    expect(canCancel(order, { id: "seller-1", role: "seller", shopId: "shop-1" })).toBe(true)
  })
  it("seller of another shop cannot", () => {
    expect(canCancel(order, { id: "seller-1", role: "seller", shopId: "shop-9" })).toBe(false)
  })
  it("seller without a resolved shop cannot cancel", () => {
    expect(canCancel(order, { id: "seller-1", role: "seller" })).toBe(false)
  })
  it("admin can always cancel live orders", () => {
    expect(canCancel(order, { id: "admin-1", role: "super_admin" })).toBe(true)
  })
  it("nobody cancels shipped/delivered orders", () => {
    for (const status of ["shipped", "delivered", "cancelled"] as OrderStatus[]) {
      expect(canCancel({ ...order, status }, { id: "admin-1", role: "super_admin" })).toBe(false)
    }
  })
})

describe("canMarkPaid", () => {
  const viewer = { id: "seller-1", role: "seller" as const }

  it("seller marks paid only after delivery", () => {
    expect(canMarkPaid("pending", "unpaid", viewer)).toBe(false)
    expect(canMarkPaid("confirmed", "unpaid", viewer)).toBe(false)
    expect(canMarkPaid("shipped", "unpaid", viewer)).toBe(false)
    expect(canMarkPaid("delivered", "unpaid", viewer)).toBe(true)
  })
  it("admin may reconcile manually at any live stage", () => {
    const admin = { id: "admin-1", role: "super_admin" as const }
    expect(canMarkPaid("pending", "unpaid", admin)).toBe(true)
    expect(canMarkPaid("confirmed", "unpaid", admin)).toBe(true)
  })
  it("never marks cancelled orders or already-paid ones", () => {
    expect(canMarkPaid("cancelled", "unpaid", viewer)).toBe(false)
    expect(canMarkPaid("delivered", "paid", viewer)).toBe(false)
  })
})
