import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { formatMoney } from "@ecommerce/config"
import {
  createAddress,
  getCart,
  listAddresses,
  placeOrder,
} from "@/server/commerce"
import { unwrap } from "@/lib/unwrap"
import { setCartCount } from "@/lib/cart-store"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

export const Route = createFileRoute("/checkout")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: "/checkout" } })
    }
  },
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData({
      queryKey: ["cart"],
      queryFn: () => getCart().then(unwrap),
    })
    await queryClient.ensureQueryData({
      queryKey: ["addresses"],
      queryFn: () => listAddresses().then(unwrap),
    })
  },
  component: CheckoutPage,
})

function CheckoutPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [placing, setPlacing] = useState(false)

  const { data: cart } = useQuery({
    queryKey: ["cart"],
    queryFn: () => getCart().then(unwrap),
  })
  const { data: addresses } = useQuery({
    queryKey: ["addresses"],
    queryFn: () => listAddresses().then(unwrap),
  })

  const chosen =
    selected ??
    addresses?.find((a) => a.isDefault)?.id ??
    addresses?.[0]?.id ??
    null

  const addAddress = useMutation({
    mutationFn: (form: FormData) => {
      const get = (k: string) => String(form.get(k) ?? "").trim()
      return createAddress({
        data: {
          label: get("label") || undefined,
          fullName: get("fullName"),
          phone: get("phone"),
          line1: get("line1"),
          line2: get("line2") || undefined,
          city: get("city"),
          state: get("state") || undefined,
          postalCode: get("postalCode") || undefined,
          country: get("country") || "US",
        },
      })
    },
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error.message)
        return
      }
      toast.success("Address added")
      setShowNew(false)
      setSelected(r.data.id)
      void queryClient.invalidateQueries({ queryKey: ["addresses"] })
    },
  })

  async function place() {
    if (!chosen) {
      toast.error("Choose or add a delivery address first")
      return
    }
    setPlacing(true)
    const result = await placeOrder({ data: { addressId: chosen } })
    setPlacing(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setCartCount(0)
    void queryClient.invalidateQueries({ queryKey: ["cart"] })
    void queryClient.invalidateQueries({ queryKey: ["addresses"] })
    toast.success(
      `Order ${result.data.orderNumber} placed — pay cash on delivery`
    )
    await navigate({
      to: "/account/orders/$id",
      params: { id: result.data.id },
      search: {},
    })
  }

  if (!cart || !addresses) return null

  if (cart.items.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">Your cart is empty</h1>
        <Button
          render={<Link to="/products" search={{}} />}
          variant="outline"
          className="mt-4"
        >
          Browse products
        </Button>
      </main>
    )
  }

  const currency = cart.items[0]?.currency ?? "USD"

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Checkout</h1>
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Delivery address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {addresses.length > 0 && !showNew && (
              <RadioGroup
                value={chosen ?? undefined}
                onValueChange={(v) => setSelected(v ?? null)}
              >
                {addresses.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                  >
                    <RadioGroupItem value={a.id} className="mt-0.5" />
                    <div>
                      <div className="font-medium">
                        {a.fullName} · {a.phone}
                        {a.label ? (
                          <span className="ml-2 text-muted-foreground">
                            ({a.label})
                          </span>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground">
                        {a.line1}
                        {a.line2 ? `, ${a.line2}` : ""}, {a.city}
                        {a.state ? `, ${a.state}` : ""} {a.postalCode ?? ""},{" "}
                        {a.country}
                      </div>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            )}

            {!showNew ? (
              <Button variant="outline" onClick={() => setShowNew(true)}>
                + New address
              </Button>
            ) : (
              <form
                className="grid grid-cols-2 gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  addAddress.mutate(new FormData(e.currentTarget))
                }}
              >
                {(
                  [
                    ["label", "Label (optional)", false],
                    ["fullName", "Full name *", true],
                    ["phone", "Phone *", true],
                    ["line1", "Address line 1 *", true],
                    ["line2", "Address line 2", false],
                    ["city", "City *", true],
                    ["state", "State", false],
                    ["postalCode", "Postal code", false],
                    ["country", "Country code *", true],
                  ] as const
                ).map(([name, label, required]) => (
                  <div key={name} className="space-y-1">
                    <Label htmlFor={`addr-${name}`}>{label}</Label>
                    <Input
                      id={`addr-${name}`}
                      name={name}
                      required={required}
                    />
                  </div>
                ))}
                <div className="col-span-2 flex gap-2">
                  <Button type="submit" disabled={addAddress.isPending}>
                    Save address
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowNew(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Order summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {cart.items.map((i) => (
              <div key={i.itemId} className="flex justify-between gap-2">
                <span className="line-clamp-1">
                  {i.title} × {i.quantity}
                </span>
                <span>{formatMoney(i.priceCents * i.quantity, currency)}</span>
              </div>
            ))}
            <div className="border-t pt-2 font-semibold">
              <div className="flex justify-between">
                <span>Total — cash on delivery</span>
                <span>{formatMoney(cart.subtotalCents, currency)}</span>
              </div>
            </div>
            <Button
              className="w-full"
              size="lg"
              onClick={place}
              disabled={placing || !chosen}
            >
              {placing ? "Placing…" : "Place order (pay on delivery)"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
