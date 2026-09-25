import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { markOrderPaid, updateOrderStatus } from "@/server/commerce"
import type { OrderStatus } from "@/lib/order-machine"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

/**
 * Renders the legal next actions for an order given the viewer role
 * (server re-validates everything — plan-8 matrix).
 */
export function OrderActions({
  orderId,
  status,
  paymentStatus,
  role,
  onChanged,
}: {
  orderId: string
  status: OrderStatus
  paymentStatus: string
  role: "super_admin" | "seller" | "buyer"
  onChanged?: () => void
}) {
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState("")

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["shop-orders"] })
    void queryClient.invalidateQueries({ queryKey: ["admin-orders"] })
    void queryClient.invalidateQueries({ queryKey: ["my-orders"] })
    onChanged?.()
  }

  const transition = useMutation({
    mutationFn: (input: { status: OrderStatus; reason?: string }) =>
      updateOrderStatus({ data: { orderId, status: input.status, reason: input.reason } }),
    onSuccess: (r, vars) => {
      if (!r.ok) {
        toast.error(r.error.message)
        return
      }
      toast.success(`Order ${vars.status}`)
      setCancelling(false)
      refresh()
    },
  })
  const markPaid = useMutation({
    mutationFn: () => markOrderPaid({ data: { orderId } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Payment recorded")
      refresh()
    },
  })

  if (status === "cancelled") return null
  const buttons: React.ReactNode[] = []

  if (status === "pending" && role !== "buyer") {
    buttons.push(
      <Button
        key="confirm"
        size="xs"
        onClick={() => transition.mutate({ status: "confirmed" })}
      >
        Confirm
      </Button>,
    )
  }
  if (status === "confirmed" && role !== "buyer") {
    buttons.push(
      <Button key="ship" size="xs" onClick={() => transition.mutate({ status: "shipped" })}>
        Ship
      </Button>,
    )
  }
  if (status === "shipped" && role !== "buyer") {
    buttons.push(
      <Button key="deliver" size="xs" onClick={() => transition.mutate({ status: "delivered" })}>
        Mark delivered
      </Button>,
    )
  }
  if (
    (status === "delivered" && role !== "buyer" && paymentStatus === "unpaid") ||
    (role === "super_admin" && paymentStatus === "unpaid")
  ) {
    buttons.push(
      <Button key="paid" size="xs" variant="secondary" onClick={() => markPaid.mutate()}>
        Mark paid (cash)
      </Button>,
    )
  }
  if (status === "pending" || status === "confirmed") {
    buttons.push(
      <Button key="cancel" size="xs" variant="outline" onClick={() => setCancelling(true)}>
        Cancel
      </Button>,
    )
  }

  return (
    <>
      <div className="flex flex-wrap justify-end gap-1.5">{buttons}</div>
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this order?</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Reason (required) — e.g. changed my mind, out of stock…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelling(false)}>
              Keep order
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => transition.mutate({ status: "cancelled", reason: reason.trim() })}
            >
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
