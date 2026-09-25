import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { formatMoney } from "@ecommerce/config"
import { listMyOrders } from "@/server/commerce"
import { unwrap } from "@/lib/unwrap"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

export const Route = createFileRoute("/account/orders/")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData({
      queryKey: ["my-orders"],
      queryFn: () => listMyOrders().then(unwrap),
    })
  },
  component: MyOrdersPage,
})

const statusVariant = (s: string) =>
  s === "delivered" || s === "confirmed"
    ? "default"
    : s === "cancelled"
      ? "destructive"
      : "secondary"

function MyOrdersPage() {
  const { data: orders } = useQuery({
    queryKey: ["my-orders"],
    queryFn: () => listMyOrders().then(unwrap),
  })

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">My orders</h1>
      <div className="space-y-3">
        {(orders ?? []).map((o) => (
          <Card key={o.id} className="py-0">
            <CardContent className="flex items-center gap-4 py-4">
              <div className="flex-1">
                <Link
                  to="/account/orders/$id"
                  params={{ id: o.id }}
                  search={{}}
                  className="font-medium hover:underline"
                >
                  {o.orderNumber}
                </Link>
                <p className="text-muted-foreground text-xs">
                  {o.itemCount} item(s) · {new Date(o.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
              <Badge variant={o.paymentStatus === "paid" ? "default" : "outline"}>
                {o.paymentStatus}
              </Badge>
              <span className="w-24 text-right text-sm font-semibold">
                {formatMoney(o.totalCents, o.currency)}
              </span>
            </CardContent>
          </Card>
        ))}
        {orders?.length === 0 && (
          <p className="text-muted-foreground py-12 text-center text-sm">
            No orders yet — your placed orders will appear here.
          </p>
        )}
      </div>
    </main>
  )
}
