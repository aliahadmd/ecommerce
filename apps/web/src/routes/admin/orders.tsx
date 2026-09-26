import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { formatMoney } from "@ecommerce/config"
import { listAllOrders } from "@/server/commerce"
import { unwrap } from "@/lib/unwrap"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/admin/orders")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData({
      queryKey: ["admin-orders"],
      queryFn: () => listAllOrders().then(unwrap),
    })
  },
  component: AdminOrdersPage,
})

const statusVariant = (s: string) =>
  s === "delivered" || s === "confirmed"
    ? "default"
    : s === "cancelled"
      ? "destructive"
      : "secondary"

function AdminOrdersPage() {
  const { data: orders } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: () => listAllOrders().then(unwrap),
  })

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">All orders</h1>
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
              <TableRow key={o.id}>
                <TableCell>
                  <div className="font-medium">{o.orderNumber}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(o.createdAt).toLocaleString()}
                  </div>
                </TableCell>
                <TableCell>{o.buyerName}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={o.paymentStatus === "paid" ? "default" : "outline"}
                  >
                    {o.paymentStatus}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {formatMoney(o.totalCents, o.currency)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  fulfill via sub-orders
                </TableCell>
              </TableRow>
            ))}
            {orders?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-muted-foreground"
                >
                  No orders yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
