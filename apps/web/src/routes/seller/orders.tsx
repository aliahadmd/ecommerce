import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { formatMoney } from "@ecommerce/config"
import { getSubOrderDetail, listShopSubOrders } from "@/server/sub-orders"
import { unwrap } from "@/lib/unwrap"
import { Pager } from "@/components/pager"
import { LIST_PAGE_SIZE } from "@/lib/pagination"
import { SubOrderActions } from "@/components/sub-order-actions"
import type { PaymentState } from "@/lib/order-status"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/seller/orders")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData({
      queryKey: ["shop-sub-orders", 1],
      queryFn: () => listShopSubOrders({ data: { page: 1 } }).then(unwrap),
    })
  },
  component: SellerSubOrdersPage,
})

const statusVariant = (s: string) =>
  s === "delivered" || s === "confirmed"
    ? "default"
    : s === "cancelled"
      ? "destructive"
      : "secondary"

interface SubOrderRow {
  id: string
  orderId: string
  orderNumber: string
  status: Status
  totalCents: number
  currency: string
  buyerName: string
  createdAt: string | Date
  itemCount: number
  paymentMethod: "cod" | "card" | null
  paymentState: PaymentState | null
}

type Status = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled"

function SellerSubOrdersPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const { data: orders } = useQuery({
    queryKey: ["shop-sub-orders", page],
    queryFn: () => listShopSubOrders({ data: { page } }).then(unwrap),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["shop-sub-orders"] })
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Incoming orders</h1>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(orders ?? []).map((o) => (
              <SellerSubOrderRow key={o.id} row={o} onChanged={refresh} />
            ))}
            {orders?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  No sub-orders yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Pager page={page} onPage={setPage} count={orders?.length ?? 0} pageSize={LIST_PAGE_SIZE} />
    </div>
  )
}

function SellerSubOrderRow({
  row,
  onChanged,
}: {
  row: SubOrderRow & { currency: string }
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const { data: detail } = useQuery({
    queryKey: ["sub-order-detail", row.id],
    queryFn: () => getSubOrderDetail({ data: { id: row.id } }).then(unwrap),
    enabled: open,
  })

  return (
    <TableRow>
      <TableCell>
        <button className="font-medium hover:underline" onClick={() => setOpen(true)}>
          {row.orderNumber}
        </button>
        <p className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </p>
      </TableCell>
      <TableCell>{row.buyerName}</TableCell>
      <TableCell>{row.itemCount} item(s)</TableCell>
      <TableCell>
        <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
      </TableCell>
      <TableCell className="text-right">
        {formatMoney(row.totalCents, row.currency)}
      </TableCell>
      <TableCell className="text-right">
        <SubOrderActions
          subOrderId={row.id}
          status={row.status}
          role="seller"
          onChanged={onChanged}
          orderId={row.orderId}
          payment={
            row.paymentMethod && row.paymentState
              ? { method: row.paymentMethod, state: row.paymentState }
              : null
          }
        />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Order {row.orderNumber}</DialogTitle>
            </DialogHeader>
            {detail && (
              <div className="space-y-2 text-sm">
                {detail.items.map((i) => (
                  <div key={i.id} className="flex justify-between">
                    <span>
                      {i.title}
                      {i.variantTitle ? ` — ${i.variantTitle}` : ""} × {i.quantity}
                    </span>
                    <span>{formatMoney(i.totalCents, row.currency)}</span>
                  </div>
                ))}
                <p className="pt-2 text-muted-foreground">
                  Ship to the buyer address on the parent order.
                </p>
              </div>
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  )
}
