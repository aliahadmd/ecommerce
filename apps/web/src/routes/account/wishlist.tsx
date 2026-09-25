import { createFileRoute, Link, redirect } from "@tanstack/react-router"

import { formatMoney } from "@ecommerce/config"
import { listWishlist, toggleWishlist } from "@/server/wishlist"
import { unwrap } from "@/lib/unwrap"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Heart } from "lucide-react"

export const Route = createFileRoute("/account/wishlist")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: "/account/wishlist" } })
    }
  },
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData({
      queryKey: ["wishlist"],
      queryFn: () => listWishlist().then(unwrap),
    })
  },
  component: WishlistPage,
})

function WishlistPage() {
  const queryClient = useQueryClient()
  const { data: items } = useQuery({
    queryKey: ["wishlist"],
    queryFn: () => listWishlist().then(unwrap),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["wishlist"] })
  }

  const unsave = useMutation({
    mutationFn: (productId: string) => toggleWishlist({ data: { productId } }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.error.message)
      refresh()
    },
  })

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <Button render={<Link to="/account" search={{}} />} variant="ghost" size="sm" className="mb-4">
        ← My account
      </Button>
      <h1 className="mb-6 flex items-center gap-2 text-xl font-semibold">
        <Heart className="size-5" /> Wishlist
      </h1>

      <div className="space-y-3">
        {(items ?? []).map((p) => (
          <Card key={p.id} className="py-0">
            <CardContent className="flex items-center gap-4 py-4">
              <Link to="/products/$slug" params={{ slug: p.slug }} className="shrink-0">
                <div className="bg-muted size-16 overflow-hidden rounded-lg">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">🛍️</div>
                  )}
                </div>
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  to="/products/$slug"
                  params={{ slug: p.slug }}
                  className="line-clamp-1 text-sm font-medium hover:underline"
                >
                  {p.title}
                </Link>
                <p className="text-muted-foreground text-xs">
                  {formatMoney(p.priceCents, p.currency)} · {p.shopName}
                  {p.stock === 0 && <span className="ml-2">out of stock</span>}
                </p>
              </div>
              {p.condition && p.condition !== "new" && (
                <Badge variant="outline" className="capitalize">
                  {p.condition}
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={p.stock === 0}
                render={<Link to="/products/$slug" params={{ slug: p.slug }} search={{}} />}
              >
                View
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove from wishlist"
                onClick={() => unsave.mutate(p.id)}
              >
                <Heart className="fill-destructive text-destructive size-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
        {items?.length === 0 && (
          <div className="text-muted-foreground py-16 text-center text-sm">
            Nothing saved yet. Tap the ♡ on any product to save it here.
          </div>
        )}
      </div>
    </main>
  )
}
