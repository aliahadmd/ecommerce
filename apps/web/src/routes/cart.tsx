import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { formatMoney } from "@ecommerce/config"
import { toast } from "sonner"
import { getCart, removeCartItem, updateCartItem } from "@/server/commerce"
import { applyCoupon, getAppliedCoupon, removeCoupon } from "@/server/coupons"
import { unwrap } from "@/lib/unwrap"
import { setCartCount } from "@/lib/cart-store"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"

export const Route = createFileRoute("/cart")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: "/cart" } })
    }
  },
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData({
      queryKey: ["cart"],
      queryFn: () => getCart().then(unwrap),
    })
  },
  component: CartPage,
})

function CartPage() {
  const queryClient = useQueryClient()
  const { data: cart } = useQuery({
    queryKey: ["cart"],
    queryFn: () => getCart().then(unwrap),
  })

  function afterMutation(count: number) {
    setCartCount(count)
    void queryClient.invalidateQueries({ queryKey: ["cart"] })
  }

  const remove = useMutation({
    mutationFn: (itemId: string) => removeCartItem({ data: { itemId } }),
    onSuccess: (r) => {
      if (r.ok) afterMutation(r.data.count)
    },
    onError: (e) => toast.error(e.message),
  })
  const applyCode = useMutation({
    mutationFn: (code: string) => applyCoupon({ data: { code } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      else toast.success(`Coupon ${r.data.code} applied`)
      void queryClient.invalidateQueries({ queryKey: ["coupon"] })
    },
  })
  const removeCode = useMutation({
    mutationFn: () => removeCoupon(),
    onSuccess: () => {
      toast.success("Coupon removed")
      void queryClient.invalidateQueries({ queryKey: ["coupon"] })
    },
  })
  const { data: applied } = useQuery({
    queryKey: ["coupon"],
    queryFn: () => getAppliedCoupon().then((r) => (r.ok ? r.data : null)),
  })

  const update = useMutation({
    mutationFn: (input: { itemId: string; quantity: number }) =>
      updateCartItem({ data: input }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error.message)
        return
      }
      if ("count" in r.data && typeof r.data.count === "number")
        afterMutation(r.data.count)
    },
    onError: (e) => toast.error(e.message),
  })

  if (!cart) return null

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Your cart</h1>
      {cart.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Your cart is empty.{" "}
            <Link to="/products" search={{}} className="underline">
              Browse products
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {cart.items.map((item) => (
            <Card key={item.itemId} className="flex-row items-center gap-4 p-4">
              <Link
                to="/products/$slug"
                params={{ slug: item.slug }}
                className="shrink-0"
              >
                <div className="size-16 overflow-hidden rounded-lg bg-muted">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      🛍️
                    </div>
                  )}
                </div>
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  to="/products/$slug"
                  params={{ slug: item.slug }}
                  className="line-clamp-1 text-sm font-medium hover:underline"
                >
                  {item.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {formatMoney(item.priceCents, item.currency)} ·{" "}
                  {item.shopName}
                  {item.quantity > item.stock && (
                    <span className="ml-2 text-destructive">
                      only {item.stock} left
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={() =>
                    update.mutate({
                      itemId: item.itemId,
                      quantity: item.quantity - 1,
                    })
                  }
                >
                  −
                </Button>
                <Input
                  className="w-12 text-center"
                  defaultValue={item.quantity}
                  key={item.itemId + item.quantity}
                  onBlur={(e) => {
                    const q = Number(e.target.value)
                    if (Number.isInteger(q) && q > 0 && q !== item.quantity) {
                      update.mutate({ itemId: item.itemId, quantity: q })
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={() =>
                    update.mutate({
                      itemId: item.itemId,
                      quantity: item.quantity + 1,
                    })
                  }
                >
                  +
                </Button>
              </div>
              <div className="w-20 text-right text-sm font-semibold">
                {formatMoney(item.priceCents * item.quantity, item.currency)}
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Remove"
                onClick={() => remove.mutate(item.itemId)}
              >
                ×
              </Button>
            </Card>
          ))}

          <Separator />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-semibold">
              {formatMoney(
                cart.subtotalCents,
                cart.items[0]?.currency ?? "USD"
              )}
            </span>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const code = String(new FormData(e.currentTarget).get("code") ?? "").trim()
              if (code) applyCode.mutate(code)
              e.currentTarget.reset()
            }}
          >
            <Input name="code" placeholder="Coupon code" className="max-w-40" />
            <Button type="submit" variant="outline" size="sm" disabled={applyCode.isPending}>
              Apply
            </Button>
          </form>
          {applied && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-green-600 dark:text-green-400">
                Coupon {applied.code} applied
                <button className="ml-2 underline" onClick={() => removeCode.mutate()}>
                  remove
                </button>
              </span>
              <span>
                -
                {formatMoney(applied.discountCents, cart.items[0]?.currency ?? "USD")}
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Payment: cash on delivery — you pay when the order arrives.
          </p>
          <div className="flex justify-end">
            <Button render={<Link to="/checkout" search={{}} />} size="lg">
              Checkout
            </Button>
          </div>
        </div>
      )}
    </main>
  )
}
