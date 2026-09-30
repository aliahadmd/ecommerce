import { describe, expect, it } from "vitest"
import {
  deriveOrderStatus,
  paymentAllowsFulfillment,
  settleOutcome,
} from "./order-status"

describe("deriveOrderStatus", () => {
  it.each([
    [["shipped"], "shipped"],
    [["confirmed", "confirmed"], "confirmed"],
    [["shipped", "delivered"], "shipped"],
    [["confirmed", "cancelled"], "confirmed"],
    [["delivered", "cancelled"], "delivered"],
    [["delivered", "delivered"], "delivered"],
    [["pending", "shipped"], "pending"],
    [["cancelled", "cancelled"], "cancelled"],
  ] as const)("%j → %s", (input, expected) => {
    expect(deriveOrderStatus([...input])).toBe(expected)
  })
})

describe("paymentAllowsFulfillment", () => {
  it("allows COD awaiting delivery and legacy rows", () => {
    expect(paymentAllowsFulfillment(null)).toBe(true)
    expect(
      paymentAllowsFulfillment({ method: "cod", state: "pending_on_delivery" })
    ).toBe(true)
  })
  it("blocks unpaid card orders", () => {
    for (const state of ["requires_payment", "processing", "failed"] as const) {
      expect(paymentAllowsFulfillment({ method: "card", state })).toBe(false)
    }
    expect(paymentAllowsFulfillment({ method: "card", state: "succeeded" })).toBe(true)
  })
})

describe("settleOutcome", () => {
  it("is idempotent on succeeded", () => {
    expect(
      settleOutcome({ current: "succeeded", outcome: "failed", activeSubOrders: 1 })
    ).toBe("noop")
  })
  it("never confirms a fully cancelled order", () => {
    expect(
      settleOutcome({ current: "requires_payment", outcome: "succeeded", activeSubOrders: 0 })
    ).toBe("failed")
  })
  it("settles a live order", () => {
    expect(
      settleOutcome({ current: "requires_payment", outcome: "succeeded", activeSubOrders: 2 })
    ).toBe("succeeded")
  })
  it("ignores callbacks for abandoned/failed intents", () => {
    expect(
      settleOutcome({ current: "failed", outcome: "succeeded", activeSubOrders: 1 })
    ).toBe("noop")
  })
})
