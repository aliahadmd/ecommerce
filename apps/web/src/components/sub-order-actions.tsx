import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { updateSubOrderStatus } from "@/server/sub-orders"
import { markCodPaid } from "@/server/payments"
import { paymentAllowsFulfillment } from "@/lib/order-status"
import type { PaymentState } from "@/lib/order-status"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

type Status = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled"

/**
 * Sub-order fulfillment actions (plan-2): confirm → ship → delivered,
 * cancel with reason while pending/confirmed. Server re-validates the matrix.
 */
export function SubOrderActions({
  subOrderId,
  status,
  role,
  onChanged,
  orderId,
  payment,
}: {
  subOrderId: string
  status: Status
  role: "seller" | "admin" | "buyer"
  onChanged?: () => void
  /** needed for the COD "cash received" action */
  orderId?: string
  payment?: { method: "cod" | "card"; state: PaymentState } | null
}) {
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState("")

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["shop-sub-orders"] })
    void queryClient.invalidateQueries({ queryKey: ["admin-orders"] })
    void queryClient.invalidateQueries({ queryKey: ["my-orders"] })
    void queryClient.invalidateQueries({ queryKey: ["my-order"] })
    onChanged?.()
  }

  const transition = useMutation({
    mutationFn: (input: { status: Status; reason?: string }) =>
      updateSubOrderStatus({
        data: { subOrderId, status: input.status, reason: input.reason },
      }),
    onSuccess: (r, vars) => {
      if (!r.ok) {
        toast.error(r.error.message)
        return
      }
      toast.success(`Sub-order ${vars.status}`)
      setCancelling(false)
      refresh()
    },
  })

  const cashReceived = useMutation({
    mutationFn: () => markCodPaid({ data: { orderId: orderId! } }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error.message)
        return
      }
      toast.success("Cash payment recorded")
      refresh()
    },
  })

  if (status === "cancelled") return null
  const buttons: React.ReactNode[] = []
  const canFulfill = paymentAllowsFulfillment(payment ?? null)

  if (role !== "buyer" && !canFulfill && status === "pending") {
    buttons.push(
      <span key="awaiting" className="text-muted-foreground self-center text-xs">
        Awaiting card payment
      </span>,
    )
  }

  if (status === "pending" && role !== "buyer" && canFulfill) {
    buttons.push(
      <Button key="confirm" size="xs" onClick={() => transition.mutate({ status: "confirmed" })}>
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
    status === "delivered" &&
    role !== "buyer" &&
    orderId &&
    payment?.method === "cod" &&
    payment.state === "pending_on_delivery"
  ) {
    buttons.push(
      <Button
        key="cash"
        size="xs"
        disabled={cashReceived.isPending}
        onClick={() => cashReceived.mutate()}
      >
        Cash received
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
            <DialogTitle>Cancel this sub-order?</DialogTitle>
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
              Cancel sub-order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
