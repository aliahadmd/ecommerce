import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { formatMoney } from "@ecommerce/config"
import { getOrderDetail, listShopOrders } from "@/server/commerce"
import { unwrap } from "@/lib/unwrap"
import { OrderActions } from "@/components/order-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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

import { useState } from "react"

export const Route = createFileRoute("/seller/orders")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData({
      queryKey: ["shop-orders"],
      queryFn: () => listShopOrders().then(unwrap),
    })
  },
  component: SellerOrdersPage,
})

const statusVariant = (s: string) =>
  s === "delivered" || s === "confirmed"
    ? "default"
    : s === "cancelled"
      ? "destructive"
      : "secondary"

function SellerOrdersPage() {
  const { data: orders } = useQuery({
    queryKey: ["shop-orders"],
    queryFn: () => listShopOrders().then(unwrap),
  })

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Incoming orders</h1>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(orders ?? []).map((o) => (
              <SellerOrderRow key={o.id} order={o} />
            ))}
            {orders?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-12 text-center">
                  No orders containing your products yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function SellerOrderRow({
  order,
}: {
  order: {
    id: string
    orderNumber: string
    status: string
    paymentStatus: string
    totalCents: number
    currency: string
    buyerName: string
    createdAt: string | Date
  }
}) {
  const [open, setOpen] = useState(false)
  const { data: detail } = useQuery({
    queryKey: ["order-detail", order.id],
    queryFn: () => getOrderDetail({ data: { id: order.id } }).then(unwrap),
    enabled: open,
  })

  return (
    <TableRow>
      <TableCell>
        <button className="font-medium hover:underline" onClick={() => setOpen(true)}>
          {order.orderNumber}
        </button>
        <p className="text-muted-foreground text-xs">
          {new Date(order.createdAt).toLocaleString()}
        </p>
      </TableCell>
      <TableCell>{order.buyerName}</TableCell>
      <TableCell>
        <Badge variant={statusVariant(order.status)}>{order.status}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant={order.paymentStatus === "paid" ? "default" : "outline"}>
          {order.paymentStatus}
        </Badge>
      </TableCell>
      <TableCell className="text-right">{formatMoney(order.totalCents, order.currency)}</TableCell>
      <TableCell>
        <OrderActions
          orderId={order.id}
          status={order.status as OrderStatusAlias}
          paymentStatus={order.paymentStatus}
          role="seller"
        />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Order {order.orderNumber}</DialogTitle>
            </DialogHeader>
            {detail && (
              <Card>
                <CardContent className="space-y-2 py-4 text-sm">
                  {detail.items.map((i) => (
                    <div key={i.id} className="flex justify-between">
                      <span>
                        {i.title} × {i.quantity}
                      </span>
                      <span>{formatMoney(i.totalCents, detail.order.currency)}</span>
                    </div>
                  ))}
                  <p className="text-muted-foreground pt-2">
                    Deliver to: {detail.order.shipName}, {detail.order.shipLine1},{" "}
                    {detail.order.shipCity} · {detail.order.shipPhone}
                  </p>
                </CardContent>
              </Card>
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

type OrderStatusAlias = Parameters<typeof OrderActions>[0]["status"]
