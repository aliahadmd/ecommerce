import { createFileRoute, Link } from "@tanstack/react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { formatMoney } from "@ecommerce/config"
import { getMyOrder } from "@/server/commerce"
import { startCheckoutPayment } from "@/server/payments"
import { unwrap } from "@/lib/unwrap"
import { SubOrderActions } from "@/components/sub-order-actions"
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
  const { data, refetch } = useQuery({
    queryKey: ["my-order", id],
    queryFn: () => getMyOrder({ data: { id } }).then(unwrap),
  })
  // plan 002: a failed or abandoned card payment can be retried from here
  const pay = useMutation({
    mutationFn: () => startCheckoutPayment({ data: { orderId: id, method: "card" } }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error.message)
        return
      }
      if (r.data.payUrl) window.location.href = r.data.payUrl
      else void refetch()
    },
  })

  if (!data)
    return <main className="mx-auto max-w-3xl px-4 py-8">Loading…</main>
  const { order, items, subOrders, payment } = data
  const awaitingCard =
    payment?.method === "card" &&
    (payment.state === "requires_payment" || payment.state === "failed") &&
    order.status !== "cancelled"

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
          {awaitingCard ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-3">
              <span>
                {payment.state === "failed"
                  ? "Your card payment didn't go through."
                  : "This order is waiting for your card payment."}{" "}
                Unpaid orders are cancelled automatically after a while.
              </span>
              <Button size="sm" disabled={pay.isPending} onClick={() => pay.mutate()}>
                {payment.state === "failed" ? "Retry payment" : "Pay now"}
              </Button>
            </div>
          ) : (
            order.status === "pending" &&
            payment?.method !== "card" && (
              <p className="rounded-lg bg-muted p-3">
                Your order is awaiting seller confirmation. Payment is cash on
                delivery.
              </p>
            )
          )}
          {subOrders.map((sub) => (
            <div key={sub.id} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium">{sub.shopName}</span>
                <Badge variant={sub.status === "cancelled" ? "destructive" : "secondary"}>
                  {sub.status}
                </Badge>
                {sub.cancelReason && (
                  <span className="text-xs text-muted-foreground">({sub.cancelReason})</span>
                )}
                <div className="ml-auto">
                  <SubOrderActions
                    subOrderId={sub.id}
                    status={sub.status}
                    role="buyer"
                    onChanged={() => void refetch()}
                  />
                </div>
              </div>
              <div className="grid gap-1">
                {items
                  .filter((i) => i.subOrderId === sub.id)
                  .map((i) => (
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
              <p className="text-muted-foreground mt-2 text-right text-xs">
                Subtotal {formatMoney(sub.subtotalCents, order.currency)}
                {sub.discountCents > 0
                  ? ` − discount ${formatMoney(sub.discountCents, order.currency)}`
                  : ""}
                {sub.shippingCents > 0
                  ? ` + shipping ${formatMoney(sub.shippingCents, order.currency)}`
                  : ""}{" "}
                = {formatMoney(sub.totalCents, order.currency)}
              </p>
            </div>
          ))}
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
