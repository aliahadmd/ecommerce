import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { formatMoney } from "@ecommerce/config"
import { getMyOrder } from "@/server/commerce"
import { unwrap } from "@/lib/unwrap"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export const Route = createFileRoute("/account/orders/$id")({
  loader: async ({ context: { queryClient }, params }) => {
    await queryClient.ensureQueryData({
      queryKey: ["my-order", params.id],
      queryFn: () => getMyOrder({ data: { id: params.id } }).then(unwrap),
    })
  },
  component: OrderDetailPage,
})

function OrderDetailPage() {
  const { id } = Route.useParams()
  const { data } = useQuery({
    queryKey: ["my-order", id],
    queryFn: () => getMyOrder({ data: { id } }).then(unwrap),
  })

  if (!data)
    return <main className="mx-auto max-w-3xl px-4 py-8">Loading…</main>
  const { order, items } = data

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Button
        render={<Link to="/account/orders" search={{}} />}
        variant="ghost"
        size="sm"
        className="mb-4"
      >
        ← All orders
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            {order.orderNumber}
            <Badge>{order.status}</Badge>
            <Badge
              variant={order.paymentStatus === "paid" ? "default" : "outline"}
            >
              {order.paymentStatus}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {order.status === "pending" && (
            <p className="rounded-lg bg-muted p-3">
              Your order is awaiting seller confirmation. Payment is cash on
              delivery.
            </p>
          )}
          <div className="grid gap-1">
            {items.map((i) => (
              <div key={i.id} className="flex items-center gap-3 py-1">
                <div className="size-10 overflow-hidden rounded-md bg-muted">
                  {i.imageUrl && (
                    <img
                      src={i.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <Link
                  to="/products/$slug"
                  params={{ slug: i.slug }}
                  className="flex-1 hover:underline"
                >
                  {i.title}
                </Link>
                <span className="text-muted-foreground">× {i.quantity}</span>
                <span className="w-20 text-right">
                  {formatMoney(i.totalCents, order.currency)}
                </span>
              </div>
            ))}
          </div>
          <Separator />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total</span>
            <span className="text-base font-semibold">
              {formatMoney(order.totalCents, order.currency)}
            </span>
          </div>
          <Separator />
          <div className="text-muted-foreground">
            Deliver to: {order.shipName}, {order.shipLine1}
            {order.shipLine2 ? `, ${order.shipLine2}` : ""}, {order.shipCity}
            {order.shipState ? `, ${order.shipState}` : ""}{" "}
            {order.shipPostalCode ?? ""}, {order.shipCountry} ·{" "}
            {order.shipPhone}
          </div>
          {order.cancelReason && (
            <p className="text-destructive">Cancelled: {order.cancelReason}</p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
