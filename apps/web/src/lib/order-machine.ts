import { schema } from "@ecommerce/db"

export type OrderStatus = (typeof schema.orderStatus.enumValues)[number]
export type PaymentStatus = (typeof schema.paymentStatus.enumValues)[number]

/** Legal order status transitions (plan-1 §3 / plan-8 matrix). */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to)
}

export type OrderViewer = {
  id: string
  role: "super_admin" | "seller" | "buyer"
  /** Required for sellers: their shop's id (shopIds are shop ids, not user ids). */
  shopId?: string
}

/** Who may cancel: buyer (own, pending/confirmed), seller (own-shop orders, same stages), admin (any order, same stages). */
export function canCancel(
  order: { status: OrderStatus; buyerId: string; shopIds: string[] },
  viewer: OrderViewer,
): boolean {
  if (order.status !== "pending" && order.status !== "confirmed") return false
  if (viewer.role === "super_admin") return true
  if (viewer.role === "buyer") return order.buyerId === viewer.id
  return viewer.shopId !== undefined && order.shopIds.includes(viewer.shopId)
}

/** Cash is collected on delivery; admin may reconcile manually at any live stage. */
export function canMarkPaid(status: OrderStatus, paymentStatus: PaymentStatus, viewer: OrderViewer): boolean {
  if (paymentStatus !== "unpaid" || status === "cancelled") return false
  if (viewer.role === "super_admin") return true
  return status === "delivered"
}

export function nextAllowedActions(
  order: { status: OrderStatus; paymentStatus: PaymentStatus; buyerId: string; shopIds: string[] },
  viewer: OrderViewer,
): OrderStatus[] {
  const transitions = ORDER_TRANSITIONS[order.status].filter((to) =>
    to === "cancelled" ? canCancel(order, viewer) : true,
  )
  if (viewer.role === "seller" && order.status !== "pending" && order.status !== "confirmed" && order.status !== "shipped") {
    // sellers only advance orders containing their items — scope enforced by query
  }
  return transitions
}
