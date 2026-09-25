import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  createAddress,
  deleteAddress,
  listAddresses,
  setDefaultAddress,
} from "@/server/commerce"
import { unwrap } from "@/lib/unwrap"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export const Route = createFileRoute("/account/addresses")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({
        to: "/login",
        search: { redirect: "/account/addresses" },
      })
    }
  },
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData({
      queryKey: ["addresses"],
      queryFn: () => listAddresses().then(unwrap),
    })
  },
  component: AddressesPage,
})

function AddressesPage() {
  const queryClient = useQueryClient()
  const { data: addresses } = useQuery({
    queryKey: ["addresses"],
    queryFn: () => listAddresses().then(unwrap),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["addresses"] })
  }

  const add = useMutation({
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
      if (!r.ok) toast.error(r.error.message)
      else toast.success("Address added")
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteAddress({ data: { id } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      refresh()
    },
  })
  const makeDefault = useMutation({
    mutationFn: (id: string) => setDefaultAddress({ data: { id } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      refresh()
    },
  })

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Button
        render={<Link to="/account" search={{}} />}
        variant="ghost"
        size="sm"
        className="mb-4"
      >
        ← My account
      </Button>
      <h1 className="mb-6 text-xl font-semibold">Delivery addresses</h1>

      <div className="space-y-3">
        {(addresses ?? []).map((a) => (
          <Card key={a.id} className="py-0">
            <CardContent className="flex items-start gap-3 py-4 text-sm">
              <div className="flex-1">
                <div className="font-medium">
                  {a.fullName} · {a.phone}
                  {a.isDefault && <Badge className="ml-2">default</Badge>}
                  {a.label && (
                    <Badge variant="outline" className="ml-2">
                      {a.label}
                    </Badge>
                  )}
                </div>
                <div className="text-muted-foreground">
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ""}, {a.city}
                  {a.state ? `, ${a.state}` : ""} {a.postalCode ?? ""},{" "}
                  {a.country}
                </div>
              </div>
              <div className="flex gap-1.5">
                {!a.isDefault && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => makeDefault.mutate(a.id)}
                  >
                    Set default
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => remove.mutate(a.id)}
                >
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {addresses?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No addresses yet — add one below.
          </p>
        )}
      </div>

      <Card className="mt-6">
        <CardContent className="py-6">
          <h2 className="mb-4 text-sm font-medium">Add an address</h2>
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              add.mutate(new FormData(e.currentTarget))
              e.currentTarget.reset()
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
                <Input id={`addr-${name}`} name={name} required={required} />
              </div>
            ))}
            <div className="col-span-2">
              <Button type="submit" disabled={add.isPending}>
                Add address
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
