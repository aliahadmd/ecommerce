/**
 * Pure order/payment rules shared by the server transitions (unit-tested).
 */

export type SubOrderStatus =
  | "pending"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "cancelled"

export type PaymentState =
  | "pending_on_delivery"
  | "requires_payment"
  | "processing"
  | "succeeded"
  | "failed"
  | "refunded"
  | "partially_refunded"

const RANK: Record<Exclude<SubOrderStatus, "cancelled">, number> = {
  pending: 0,
  confirmed: 1,
  shipped: 2,
  delivered: 3,
}

/**
 * Parent order status from its sub-orders (plan-2): all cancelled →
 * cancelled; otherwise the least-advanced active stage (H3: the previous
 * version started from `pending` and could never move past it).
 */
export function deriveOrderStatus(statuses: SubOrderStatus[]): SubOrderStatus {
  if (statuses.length === 0) return "pending"
  const active = statuses.filter(
    (s): s is Exclude<SubOrderStatus, "cancelled"> => s !== "cancelled"
  )
  if (active.length === 0) return "cancelled"
  return active.reduce((min, s) => (RANK[s] < RANK[min] ? s : min), active[0])
}

/**
 * Card orders may not move past `pending` until their payment succeeded
 * (H5): otherwise a seller ships goods nobody paid for and the delivery
 * credits the ledger with money that was never collected.
 */
export function paymentAllowsFulfillment(
  payment: { method: "cod" | "card"; state: PaymentState } | null
): boolean {
  if (!payment) return true // legacy COD orders without a payments row
  if (payment.method === "cod") return payment.state !== "failed"
  return payment.state === "succeeded"
}

/**
 * Outcome of a verified gateway callback (plan 003): a late payment for a
 * fully cancelled order must never resurrect it, and a settled payment is
 * idempotent.
 */
export function settleOutcome(input: {
  current: PaymentState
  outcome: "succeeded" | "failed"
  activeSubOrders: number
}): "succeeded" | "failed" | "noop" {
  if (input.current === "succeeded") return "noop"
  if (input.current !== "requires_payment" && input.current !== "processing") {
    // failed / refunded / COD rows are not settleable by a card callback
    return "noop"
  }
  if (input.outcome === "succeeded" && input.activeSubOrders === 0) return "failed"
  return input.outcome
}
